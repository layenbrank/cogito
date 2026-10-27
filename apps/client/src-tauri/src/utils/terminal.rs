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

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFont {
    pub family: Option<String>,
    pub size: Option<u16>,
    /// Windows Terminal `font.weight`：normal / bold / 数值等，原样回传
    pub weight: Option<String>,
    /// 字体文件绝对路径；前端用 plugin-fs 读成 Blob → FontFace（勿走数 MB base64 IPC）
    pub file_path: Option<String>,
}

/// Windows `canonicalize` 会加上 `\\?\` 扩展前缀；PowerShell `Set-Location` / Oh My Posh
/// 都不认，导致 `cd Documents` 报 path 非法。剥掉后再交给 PTY。
fn strip_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
    }
    path
}

/// cwd 只接受绝对路径且须为已存在的目录（与 `workspaceFiles` 的 root 校验同款思路）。
/// 注意：PTY 内用户可自由 `cd`，此处仅约束**初始** cwd，不是运行时沙箱。
fn validate_cwd(cwd: &str) -> Result<PathBuf, String> {
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Err("终端 cwd 不能为空".into());
    }
    // 允许输入侧带 `\\?\`；校验时先剥前缀再查 `..`
    let normalized_input = strip_windows_verbatim_prefix(PathBuf::from(trimmed));
    let input_text = normalized_input.to_string_lossy();
    if input_text.split(['/', '\\']).any(|seg| seg == "..") {
        return Err("终端 cwd 非法".into());
    }
    if !normalized_input.is_absolute() {
        return Err("终端 cwd 必须为绝对路径".into());
    }
    let canonical = normalized_input
        .canonicalize()
        .map_err(|err| format!("终端 cwd 无效：{err}"))?;
    if !canonical.is_dir() {
        return Err("终端 cwd 不是有效目录".into());
    }
    Ok(strip_windows_verbatim_prefix(canonical))
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

    let id = id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // 同 id 重入（视图热重挂）：先拆掉旧会话，避免写端孤儿 / 双读线程
    if let Some(mut old) = {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话表加锁失败".to_string())?;
        sessions.remove(&id)
    } {
        #[cfg(windows)]
        if let Some(pid) = old.child.process_id() {
            terminate_process_tree(pid);
        }
        let _ = old.child.kill();
    }

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
    let Some(mut session) = sessions.remove(&id) else {
        // 幂等：视图卸载与读线程 EOF 可能先后 kill
        return Ok(());
    };

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

/// WT / conhost 占位族名（不是可安装字体），不能拿去解析文件。
fn is_placeholder_font_family(family: &str) -> bool {
    let trimmed = family.trim();
    if trimmed.is_empty() {
        return true;
    }
    matches!(
        trimmed,
        "__DefaultTTFont__" | "DefaultTTFont" | "Terminal" | "Modern"
    )
}

/// 解析系统默认终端字体：WT → conhost → 常见 Nerd Font 探测。
fn resolve_terminal_font() -> TerminalFont {
    #[cfg(windows)]
    {
        let mut resolved = read_windows_terminal_font()
            .or_else(read_conhost_font)
            .unwrap_or(TerminalFont {
                family: None,
                size: None,
                weight: None,
                file_path: None,
            });

        if resolved
            .family
            .as_deref()
            .is_some_and(is_placeholder_font_family)
        {
            log::warn!("[terminal] 忽略占位字体族名 family={:?}", resolved.family);
            resolved.family = None;
        }

        if resolved.file_path.is_none() {
            if let Some(family) = resolved.family.clone() {
                resolved.file_path = resolve_font_file_path(&family);
            }
        }

        // 仅当「当前配置族名」也找不到文件时，才回退到系统自带等宽字体。
        // 族名与文件必须成对替换，禁止 Meslo 等用户私货硬编码优先。
        if resolved.file_path.is_none() {
            if let Some(fallback) = discover_system_terminal_font() {
                log::info!(
                    "[terminal] 配置字体不可用 family={:?}，回退 {:?}",
                    resolved.family,
                    fallback.family
                );
                resolved.family = fallback.family;
                resolved.file_path = fallback.file_path;
                if resolved.size.is_none() {
                    resolved.size = fallback.size;
                }
                if resolved.weight.is_none() {
                    resolved.weight = fallback.weight;
                }
            }
        }

        if let Some(path) = resolved.file_path.as_deref() {
            log::info!(
                "[terminal] 系统终端字体 family={:?} path={path}",
                resolved.family
            );
            return resolved;
        }

        log::warn!(
            "[terminal] 未解析到可用终端字体文件 family={:?}",
            resolved.family
        );
    }
    TerminalFont {
        family: None,
        size: None,
        weight: None,
        file_path: None,
    }
}

/// 配置字体缺失时的系统兜底（Windows 自带 / WT 默认），勿塞用户私有 Nerd Font。
#[cfg(windows)]
fn discover_system_terminal_font() -> Option<TerminalFont> {
    const FAMILIES: &[&str] = &["Cascadia Mono", "Cascadia Code", "Consolas", "Courier New"];
    for family in FAMILIES {
        if let Some(path) = resolve_font_file_path(family) {
            log::info!("[terminal] 系统兜底字体 family={family} path={path}");
            return Some(TerminalFont {
                family: Some((*family).to_string()),
                size: None,
                weight: None,
                file_path: Some(path),
            });
        }
    }
    None
}

/// 商店包族名不固定（后缀 publisher id / Preview / Canary），按目录扫描，勿写死。
#[cfg(windows)]
fn wt_package_settings_rank(path: &std::path::Path) -> u8 {
    let text = path.to_string_lossy();
    if text.contains("Canary") {
        2
    } else if text.contains("Preview") {
        1
    } else {
        0
    }
}

/// Local AppData：优先 `LOCALAPPDATA`；turbo/pnpm→cargo 链有时不继承该变量，回退 `dirs`。
#[cfg(windows)]
fn local_app_data_dir() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        return Some(PathBuf::from(local));
    }
    let fallback = dirs::data_local_dir()?;
    log::warn!("[terminal] LOCALAPPDATA 缺失，回退 {}", fallback.display());
    Some(fallback)
}

/// 候选 settings.json：扫描 `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal*`，
/// 再加非商店 `%LOCALAPPDATA%\Microsoft\Windows Terminal\settings.json`。
#[cfg(windows)]
fn windows_terminal_settings_paths() -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    let Some(local) = local_app_data_dir() else {
        return paths;
    };
    let packages_dir = local.join("Packages");
    if let Ok(entries) = std::fs::read_dir(&packages_dir) {
        let mut package_settings: Vec<std::path::PathBuf> = entries
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                // 含 Stable / Preview / Canary；排除无关包
                name.starts_with("Microsoft.WindowsTerminal")
            })
            .map(|entry| entry.path().join("LocalState").join("settings.json"))
            .filter(|path| path.is_file())
            .collect();
        // Stable → Preview → Canary；同档按修改时间新→旧（用户当前在用的优先）
        package_settings.sort_by(|left, right| {
            wt_package_settings_rank(left)
                .cmp(&wt_package_settings_rank(right))
                .then_with(|| {
                    let left_mtime = std::fs::metadata(left)
                        .and_then(|meta| meta.modified())
                        .ok();
                    let right_mtime = std::fs::metadata(right)
                        .and_then(|meta| meta.modified())
                        .ok();
                    right_mtime.cmp(&left_mtime)
                })
        });
        paths.extend(package_settings);
    }
    let unpackaged = local
        .join("Microsoft")
        .join("Windows Terminal")
        .join("settings.json");
    if unpackaged.is_file() {
        paths.push(unpackaged);
    }
    paths
}

/// 从一段 WT font 对象取出 face / size / weight。
#[cfg(windows)]
fn parse_wt_font_object(font: &serde_json::Value) -> Option<TerminalFont> {
    let family = font.get("face")?.as_str()?.trim();
    if family.is_empty() || is_placeholder_font_family(family) {
        return None;
    }
    let size = font
        .get("size")
        .and_then(|s| s.as_u64().or_else(|| s.as_f64().map(|n| n.round() as u64)))
        .map(|s| s as u16);
    let weight = font.get("weight").and_then(|w| match w {
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    });
    Some(TerminalFont {
        family: Some(family.to_string()),
        size,
        weight,
        file_path: None,
    })
}

/// 合并 defaults.font 与 defaultProfile 上的 font（后者覆盖前者）。
#[cfg(windows)]
fn parse_wt_settings_font(json: &serde_json::Value) -> Option<TerminalFont> {
    let defaults = json
        .pointer("/profiles/defaults/font")
        .and_then(parse_wt_font_object);
    let profile = json
        .get("defaultProfile")
        .and_then(|v| v.as_str())
        .and_then(|guid| {
            json.pointer("/profiles/list")?
                .as_array()?
                .iter()
                .find(|item| item.get("guid").and_then(|g| g.as_str()) == Some(guid))
        })
        .and_then(|profile| profile.get("font"))
        .and_then(parse_wt_font_object);

    match (defaults, profile) {
        (None, None) => None,
        (Some(base), None) => Some(base),
        (None, Some(over)) => Some(over),
        (Some(mut base), Some(over)) => {
            if over.family.is_some() {
                base.family = over.family;
            }
            if over.size.is_some() {
                base.size = over.size;
            }
            if over.weight.is_some() {
                base.weight = over.weight;
            }
            Some(base)
        }
    }
}

/// 读 Windows Terminal settings：defaults.font ∪ defaultProfile.font。
#[cfg(windows)]
fn read_windows_terminal_font() -> Option<TerminalFont> {
    for path in windows_terminal_settings_paths() {
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let json: serde_json::Value = match serde_json::from_str(&text) {
            Ok(json) => json,
            Err(_) => continue,
        };
        if let Some(font) = parse_wt_settings_font(&json) {
            return Some(font);
        }
    }
    None
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
    if family.is_empty() || is_placeholder_font_family(&family) {
        None
    } else {
        Some(TerminalFont {
            family: Some(family),
            size: None,
            weight: None,
            file_path: None,
        })
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::{resolve_terminal_font, strip_windows_verbatim_prefix, validate_cwd};
    use std::path::PathBuf;

    #[test]
    fn resolve_terminal_font_has_family_and_file_path() {
        let font = resolve_terminal_font();
        eprintln!(
            "terminal font family={:?} path={:?}",
            font.family, font.file_path
        );
        assert!(
            font.family.as_deref().is_some_and(|s| !s.is_empty()),
            "应能读到 WT/conhost 字体族名或系统兜底"
        );
        assert!(
            font.file_path
                .as_deref()
                .is_some_and(|p| std::path::Path::new(p).is_file()),
            "应能解析到字体文件 path={:?}",
            font.file_path
        );
    }

    /// 模拟 turbo→cargo 不继承 LOCALAPPDATA 时仍能读到 WT settings。
    #[test]
    fn resolve_terminal_font_without_localappdata_env() {
        let saved = std::env::var_os("LOCALAPPDATA");
        // SAFETY: 单测进程内临时改环境变量，结束即还原
        unsafe {
            std::env::remove_var("LOCALAPPDATA");
        }
        let font = resolve_terminal_font();
        match saved {
            Some(value) => unsafe {
                std::env::set_var("LOCALAPPDATA", value);
            },
            None => unsafe {
                std::env::remove_var("LOCALAPPDATA");
            },
        }
        eprintln!(
            "no-LOCALAPPDATA font family={:?} path={:?}",
            font.family, font.file_path
        );
        assert_eq!(
            font.family.as_deref(),
            Some("MesloLGM Nerd Font"),
            "缺 LOCALAPPDATA 时应仍读到 WT defaults.font"
        );
        assert!(
            font.file_path
                .as_deref()
                .is_some_and(|p| std::path::Path::new(p).is_file()),
            "path={:?}",
            font.file_path
        );
    }

    #[test]
    fn strip_verbatim_prefix_for_drive_and_unc() {
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\C:\Users\iwell")),
            PathBuf::from(r"C:\Users\iwell")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share\dir")),
            PathBuf::from(r"\\server\share\dir")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"C:\Users\iwell")),
            PathBuf::from(r"C:\Users\iwell")
        );
    }

    #[test]
    fn validate_cwd_strips_verbatim_prefix() {
        let home = std::env::var("USERPROFILE").expect("USERPROFILE");
        let verbatim = format!(r"\\?\{home}");
        let parsed = validate_cwd(&verbatim).expect("应接受带 \\\\?\\ 的家目录");
        let text = parsed.to_string_lossy();
        assert!(
            !text.starts_with(r"\\?\"),
            "PTY cwd 不应带 verbatim 前缀，实际={text}"
        );
        assert!(parsed.is_dir());
    }
}

/// 按族名解析字体文件：优先 Mono 变体（终端栅格对齐，Oh My Posh / xterm 社区惯例）。
#[cfg(windows)]
fn resolve_font_file_path(family: &str) -> Option<String> {
    let family = family.trim();
    if family.is_empty() {
        return None;
    }
    if !family.to_ascii_lowercase().contains("mono") {
        let mono = format!("{family} Mono");
        if let Some(path) = resolve_font_file_path_exact(&mono) {
            return Some(path);
        }
    }
    resolve_font_file_path_exact(family)
}

#[cfg(windows)]
fn resolve_font_file_path_exact(family: &str) -> Option<String> {
    read_font_path_from_registry(family).or_else(|| guess_user_font_file(family))
}

/// 读 `HKCU`/`HKLM\...\Fonts`，匹配「族名 … Regular」优先。
#[cfg(windows)]
fn read_font_path_from_registry(family: &str) -> Option<String> {
    use windows::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RegCloseKey, RegEnumValueW, RegOpenKeyExW,
        RegQueryInfoKeyW,
    };

    let family_lower = family.to_ascii_lowercase();
    let keys = [
        (
            HKEY_CURRENT_USER,
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        ),
        (
            HKEY_LOCAL_MACHINE,
            "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts",
        ),
    ];

    let mut regular: Option<String> = None;
    let mut any: Option<String> = None;

    for (root, subkey) in keys {
        let subkey_w = to_wide_null(subkey);
        let mut hkey = Default::default();
        let open = unsafe {
            RegOpenKeyExW(
                root,
                windows::core::PCWSTR(subkey_w.as_ptr()),
                Some(0),
                KEY_READ,
                &mut hkey,
            )
        };
        if open.is_err() {
            continue;
        }

        let mut value_count = 0u32;
        let info = unsafe {
            RegQueryInfoKeyW(
                hkey,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(&mut value_count),
                None,
                None,
                None,
                None,
            )
        };
        if info.is_err() {
            unsafe {
                let _ = RegCloseKey(hkey);
            }
            continue;
        }

        for index in 0..value_count {
            let mut name_buf = [0u16; 512];
            let mut name_len = name_buf.len() as u32;
            let mut data_buf = [0u16; 1024];
            let mut data_bytes = (data_buf.len() * std::mem::size_of::<u16>()) as u32;
            let enumerated = unsafe {
                RegEnumValueW(
                    hkey,
                    index,
                    Some(windows::core::PWSTR(name_buf.as_mut_ptr())),
                    &mut name_len,
                    None,
                    None,
                    Some(data_buf.as_mut_ptr() as *mut u8),
                    Some(&mut data_bytes),
                )
            };
            if enumerated.is_err() {
                continue;
            }
            let name =
                String::from_utf16_lossy(&name_buf[..name_len as usize]).to_ascii_lowercase();
            if !name.starts_with(&family_lower) {
                continue;
            }
            let data_len = (data_bytes as usize / std::mem::size_of::<u16>()).saturating_sub(1);
            let raw = String::from_utf16_lossy(&data_buf[..data_len])
                .trim()
                .to_string();
            if raw.is_empty() {
                continue;
            }
            let absolute = normalize_font_file_path(&raw);
            if !std::path::Path::new(&absolute).is_file() {
                continue;
            }
            if name.contains("regular") || (!name.contains("bold") && !name.contains("italic")) {
                regular = Some(absolute);
                break;
            }
            if any.is_none() {
                any = Some(absolute);
            }
        }

        unsafe {
            let _ = RegCloseKey(hkey);
        }
        if regular.is_some() {
            break;
        }
    }

    regular.or(any)
}

/// 注册表可能只存文件名：补成 `%WINDIR%\Fonts\…`。
#[cfg(windows)]
fn normalize_font_file_path(raw: &str) -> String {
    let path = std::path::Path::new(raw);
    if path.is_absolute() {
        return raw.to_string();
    }
    if let Some(windir) = std::env::var_os("WINDIR") {
        return std::path::Path::new(&windir)
            .join("Fonts")
            .join(raw)
            .to_string_lossy()
            .into_owned();
    }
    raw.to_string()
}

/// 用户字体目录启发式：`MesloLGM Nerd Font` → `MesloLGMNerdFont-Regular.ttf`
#[cfg(windows)]
fn guess_user_font_file(family: &str) -> Option<String> {
    let dir = local_app_data_dir()?
        .join("Microsoft")
        .join("Windows")
        .join("Fonts");
    if !dir.is_dir() {
        return None;
    }
    let compact: String = family.chars().filter(|c| !c.is_whitespace()).collect();
    let candidates = [
        format!("{compact}-Regular.ttf"),
        format!("{compact}-Regular.otf"),
        format!("{compact}.ttf"),
        format!("{compact}.otf"),
    ];
    for name in candidates {
        let path = dir.join(&name);
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    None
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
