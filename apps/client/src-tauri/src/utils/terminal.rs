//! 嵌入式交互终端：portable-pty 会话管理 + `terminal:*` IPC。
//!
//! 前端 `@xterm/xterm` 渲染，Rust 侧只承担 PTY 主机（对齐 VS Code 的 PtyHost 角色），
//! 输出字节经 `tauri::ipc::Channel<Vec<u8>>` 推流，禁止反复 `invoke` 轮询读。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

/// 单次读缓冲：终端输出按块推流，8 KiB 在交互吞吐与 IPC 次数间平衡。
const READ_BUF_SIZE: usize = 8192;

struct TerminalSession {
    cwd: String,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

/// 终端会话表（managed state）。命令与读线程共享；读线程在 EOF 后自清理。
pub struct TerminalHub {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl TerminalHub {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreated {
    pub id: String,
    pub pid: Option<u32>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub id: String,
    pub exit_code: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub cwd: String,
    pub pid: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFont {
    pub family: Option<String>,
    pub size: Option<u16>,
}

/// cwd 只接受绝对路径且须为已存在的目录（与 `workspaceFiles` 的 root 校验同款思路）。
/// 注意：PTY 内用户可自由 `cd`，此处仅约束**初始** cwd，不是运行时沙箱。
fn validate_cwd(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("终端 cwd 不能为空".into());
    }
    if trimmed.contains("..") {
        return Err("终端 cwd 非法".into());
    }
    let buf = PathBuf::from(trimmed);
    if !buf.is_absolute() {
        return Err("终端 cwd 必须为绝对路径".into());
    }
    let canonical = buf
        .canonicalize()
        .map_err(|err| format!("终端 cwd 无效：{err}"))?;
    if !canonical.is_dir() {
        return Err("终端 cwd 不是有效目录".into());
    }
    Ok(canonical)
}

/// 默认 shell 由 Rust 侧决定，不接收前端传入的 shell 路径（杜绝命令注入）。
///
/// Windows 优先 `pwsh`（用户默认 shell，`$PROFILE` 个性化定制随 pwsh 自动加载），
/// 找不到再回退系统自带的 `powershell.exe`。
#[cfg(windows)]
fn default_shell() -> String {
    if find_in_path("pwsh.exe").is_some() || find_in_path("pwsh").is_some() {
        "pwsh.exe".to_string()
    } else {
        "powershell.exe".to_string()
    }
}

#[cfg(not(windows))]
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "bash".to_string())
}

/// 在 `PATH` 目录中查找可执行文件（不校验执行位，仅判断文件存在）。
#[cfg(windows)]
fn find_in_path(executable: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(executable);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command(rename = "terminal:create")]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, TerminalHub>,
    cwd: String,
    channel: Channel<InvokeResponseBody>,
    id: Option<String>,
) -> Result<TerminalCreated, String> {
    let cwd_path = validate_cwd(&cwd)?;
    let shell = default_shell();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("打开 PTY 失败：{err}"))?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&cwd_path);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("启动 shell 失败：{err}"))?;

    let id = id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("克隆 PTY 读端失败：{err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("获取 PTY 写端失败：{err}"))?;

    let session = TerminalSession {
        cwd: cwd_path.display().to_string(),
        child,
        master: pair.master,
        writer,
    };

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话表加锁失败".to_string())?;
        sessions.insert(id.clone(), session);
    }

    spawn_reader(state.sessions.clone(), app, id.clone(), channel, reader);

    Ok(TerminalCreated { id, pid })
}

/// 读线程：阻塞读 master → Channel 推原始字节；EOF 后回收会话并广播退出事件。
fn spawn_reader(
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    app: AppHandle,
    id: String,
    channel: Channel<InvokeResponseBody>,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if channel
                        .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        let exit_code = {
            let Ok(mut guard) = sessions.lock() else {
                return;
            };
            let Some(mut session) = guard.remove(&id) else {
                // 已被 terminal:kill 移除；仍通知前端退出。
                let _ = app.emit(
                    "terminal://exit",
                    TerminalExitEvent {
                        id: id.clone(),
                        exit_code: None,
                    },
                );
                return;
            };
            match session.child.try_wait() {
                // 子进程已退出并被 reap，绝不能再 kill（Unix 上 kill 已 reap 的 PID 可能误伤复用进程）。
                Ok(Some(status)) => Some(status.exit_code()),
                // 读端提前出错 / 无法查询：kill 确保回收，退出码未知。
                _ => {
                    let _ = session.child.kill();
                    None
                }
            }
        };

        let _ = app.emit("terminal://exit", TerminalExitEvent { id, exit_code });
    });
}

#[tauri::command(rename = "terminal:write")]
pub fn terminal_write(
    id: String,
    data: Vec<u8>,
    state: State<'_, TerminalHub>,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    session
        .writer
        .write_all(&data)
        .map_err(|err| format!("写入终端失败：{err}"))?;
    session
        .writer
        .flush()
        .map_err(|err| format!("刷新终端失败：{err}"))
}

#[tauri::command(rename = "terminal:resize")]
pub fn terminal_resize(
    id: String,
    rows: u16,
    cols: u16,
    pixel_width: u16,
    pixel_height: u16,
    state: State<'_, TerminalHub>,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width,
            pixel_height,
        })
        .map_err(|err| format!("调整终端尺寸失败：{err}"))
}

/// Windows：终止 `root_pid` 及其所有后代进程。
///
/// ConPTY 下 `TerminateProcess` 只杀 shell 本身，继承 ConPTY 句柄的后代（如 `npm run dev`）
/// 会让读端永不 EOF、读线程永久阻塞；故需按进程树整体回收。
#[cfg(windows)]
fn terminate_process_tree(root_pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32, Process32First, Process32Next, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE, TerminateProcess};

    let mut entries: Vec<(u32, u32)> = Vec::new();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return;
        };

        let mut entry = PROCESSENTRY32::default();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32>() as u32;

        if Process32First(snapshot, &mut entry).is_ok() {
            loop {
                entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
                if Process32Next(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    // 收集 root_pid 自身及其所有后代。
    let mut targets = vec![root_pid];
    let mut changed = true;
    while changed {
        changed = false;
        for (pid, parent) in &entries {
            if targets.contains(parent) && !targets.contains(pid) {
                targets.push(*pid);
                changed = true;
            }
        }
    }

    // 从叶子到根终止，避免残留子进程。
    for pid in targets.into_iter().rev() {
        unsafe {
            if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
                let _ = TerminateProcess(handle, 1);
                let _ = CloseHandle(handle);
            }
        }
    }
}

#[tauri::command(rename = "terminal:kill")]
pub fn terminal_kill(id: String, state: State<'_, TerminalHub>) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    let mut session = sessions
        .remove(&id)
        .ok_or_else(|| "终端会话不存在".to_string())?;

    #[cfg(windows)]
    {
        if let Some(pid) = session.child.process_id() {
            terminate_process_tree(pid);
        }
        // 进程树终止已含 shell；忽略二次 kill 的失败。
        let _ = session.child.kill();
        Ok(())
    }

    #[cfg(not(windows))]
    {
        session
            .child
            .kill()
            .map_err(|err| format!("终止终端失败：{err}"))
    }
}

#[tauri::command(rename = "terminal:list")]
pub fn terminal_list(state: State<'_, TerminalHub>) -> Result<Vec<TerminalInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    Ok(sessions
        .iter()
        .map(|(id, session)| TerminalInfo {
            id: id.clone(),
            cwd: session.cwd.clone(),
            pid: session.child.process_id(),
        })
        .collect())
}

#[tauri::command(rename = "terminal:font")]
pub fn terminal_font() -> TerminalFont {
    resolve_terminal_font()
}

/// 解析系统默认终端字体：Windows Terminal 默认 profile → conhost 注册表 → 无。
fn resolve_terminal_font() -> TerminalFont {
    #[cfg(windows)]
    {
        for package in [
            "Microsoft.WindowsTerminal_8wekyb3d8bbwe",
            "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe",
        ] {
            if let Some(font) = read_windows_terminal_font(package) {
                return font;
            }
        }
        if let Some(font) = read_conhost_font() {
            return font;
        }
    }
    TerminalFont {
        family: None,
        size: None,
    }
}

/// 读 Windows Terminal `settings.json` 的 `profiles.defaults.font`（face / size）。
#[cfg(windows)]
fn read_windows_terminal_font(package: &str) -> Option<TerminalFont> {
    let local = std::env::var_os("LOCALAPPDATA")?;
    let path = std::path::Path::new(&local)
        .join("Packages")
        .join(package)
        .join("LocalState")
        .join("settings.json");
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let font = json.get("profiles")?.get("defaults")?.get("font")?;
    let family = font.get("face")?.as_str()?.to_string();
    let size = font.get("size").and_then(|s| s.as_u64()).map(|s| s as u16);
    Some(TerminalFont {
        family: Some(family),
        size,
    })
}

/// 读 conhost 默认字体：注册表 `HKCU\Console\FaceName`。
#[cfg(windows)]
fn read_conhost_font() -> Option<TerminalFont> {
    use windows::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};

    let subkey = to_wide_null("Console");
    let value = to_wide_null("FaceName");
    let mut buf = [0u16; 256];
    let mut buf_size = (buf.len() * std::mem::size_of::<u16>()) as u32;

    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            windows::core::PCWSTR(subkey.as_ptr()),
            windows::core::PCWSTR(value.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buf.as_mut_ptr() as *mut _),
            Some(&mut buf_size as *mut _),
        )
    };

    if result.is_err() || buf_size == 0 {
        return None;
    }
    let len = (buf_size as usize / std::mem::size_of::<u16>()).saturating_sub(1);
    let family = String::from_utf16_lossy(&buf[..len]).trim().to_string();
    if family.is_empty() {
        None
    } else {
        Some(TerminalFont {
            family: Some(family),
            size: None,
        })
    }
}

/// `&str` → 以 `\0` 结尾的 UTF-16，供 Win32 宽字符串 API 使用。
#[cfg(windows)]
fn to_wide_null(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// 应用退出时回收全部 PTY 子进程。
pub fn shutdown(app: &AppHandle) {
    let Some(state) = app.try_state::<TerminalHub>() else {
        return;
    };
    let Ok(mut sessions) = state.sessions.lock() else {
        return;
    };
    for (_, mut session) in sessions.drain() {
        // Windows：与 terminal:kill 一致，先按进程树整体终止，避免孤儿子进程残留。
        #[cfg(windows)]
        if let Some(pid) = session.child.process_id() {
            terminate_process_tree(pid);
        }
        let _ = session.child.kill();
    }
}
