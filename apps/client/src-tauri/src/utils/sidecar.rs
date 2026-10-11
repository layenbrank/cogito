use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tracing::{info, warn};

use crate::utils::ipc;

/// 更新安装前等待 sidecar 退出的超时。
pub const SIDECAR_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// 应用正常退出时的较短等待，避免拖慢退出。
const SIDECAR_EXIT_TIMEOUT: Duration = Duration::from_secs(2);

const GRACEFUL_WAIT: Duration = Duration::from_millis(500);
const HANDLE_SETTLE: Duration = Duration::from_millis(200);

pub const COREX_DATA_DIR_ENV: &str = "COREX_DATA_DIR";
const COREX_DB_FILE: &str = "corex.db";

/// 与 sidecar 一致的 corex 数据目录（指令库 / token / 历史）。
pub fn corex_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(base.join("corex"))
}

pub fn corex_database_path(data_dir: &PathBuf) -> PathBuf {
    data_dir.join(COREX_DB_FILE)
}

pub struct SidecarState {
    ready: AtomicBool,
    settled: AtomicBool,
    child: Mutex<Option<CommandChild>>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self::new()
    }
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            ready: AtomicBool::new(false),
            settled: AtomicBool::new(false),
            child: Mutex::new(None),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }

    /// `None` = 仍在启动；`Some(true/false)` = 已结束。
    pub fn status(&self) -> Option<bool> {
        if !self.settled.load(Ordering::Relaxed) {
            return None;
        }
        Some(self.is_ready())
    }

    /// 以 Named Pipe 为准；可纠正超时后的误判。
    pub fn probe(&self) -> bool {
        if self.is_ready() {
            return true;
        }
        if ipc::is_ready() {
            self.mark_ready();
            return true;
        }
        false
    }

    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
    }

    pub fn fail(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
        ipc::drop_session();
    }
}

/// 启动 sidecar，并在后台等待就绪；失败时发出 `corex://not-ready`。
pub fn spawn_and_watch(app: &AppHandle, timeout: Duration) {
    match spawn(app) {
        Ok(()) => {
            let app = app.clone();
            std::thread::spawn(move || {
                let Some(state) = app.try_state::<SidecarState>() else {
                    return;
                };
                if !wait_for_daemon(timeout, &state) {
                    let _ = app.emit("corex://not-ready", ());
                }
            });
        }
        Err(e) => {
            tracing::error!("corex-daemon 启动失败: {e}");
            app.state::<SidecarState>().fail();
            let _ = app.emit("corex://not-ready", ());
        }
    }
}

/// 启动 corex-daemon sidecar 并监听进程退出。
fn spawn(app: &AppHandle) -> Result<(), String> {
    // sidecar() 只要 externalBin 的文件名，不要 `binaries/` 前缀；
    // 运行时相对 current_exe 目录解析为 `corex-daemon.exe`。
    // pdfium.dll 经 tauri.conf resources 映射到与 sidecar 同目录，无需 COREX_PDFIUM_DIR。
    let data_dir = corex_data_dir(app)?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("创建 corex 数据目录失败 ({}): {e}", data_dir.display()))?;
    let data_dir_str = data_dir.to_string_lossy().into_owned();
    // 父进程读 token / 指令库路径与 daemon 对齐
    // 父进程 token 路径与 daemon 对齐（Rust 2024：`set_var` 为 unsafe）
    unsafe {
        std::env::set_var(COREX_DATA_DIR_ENV, &data_dir_str);
    }

    let sidecar = app
        .shell()
        .sidecar("corex-daemon")
        .map_err(|e| format!("创建 corex-daemon sidecar 失败: {e}"))?
        .args(["--pipe", ipc::PIPE_NAME])
        .env(COREX_DATA_DIR_ENV, data_dir_str);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("启动 corex-daemon 失败: {e}"))?;

    {
        let state = app.state::<SidecarState>();
        let mut guard = state
            .child
            .lock()
            .map_err(|e| format!("锁定 sidecar 状态失败: {e}"))?;
        *guard = Some(child);
    }

    let app_for_task = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                warn!(
                    "corex-daemon 已退出 (code={:?}, signal={:?})",
                    payload.code, payload.signal
                );
                if let Some(state) = app_for_task.try_state::<SidecarState>() {
                    state.fail();
                    if let Ok(mut guard) = state.child.lock() {
                        *guard = None;
                    }
                }
                let _ = app_for_task.emit("corex://not-ready", ());
                break;
            }
        }
    });

    Ok(())
}

fn wait_for_daemon(timeout: Duration, state: &SidecarState) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        // 管道通了还不够：必须能读到与 daemon 一致的 auth token
        if state.probe() && ipc::auth_token().is_ok() {
            info!("corex-daemon IPC 与 auth token 已就绪");
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    state.fail();
    warn!("corex-daemon 在超时内未就绪（或缺少 auth token），重能力调用可能失败");
    false
}

/// 应用退出时关闭 sidecar（较短超时）。
pub fn shutdown(app: &AppHandle) {
    let _ = shutdown_and_wait(app, SIDECAR_EXIT_TIMEOUT);
}

/// 请求 daemon 退出，kill 子进程，并等待其释放文件句柄。
///
/// 返回 `true` 表示确认已停；超时仍返回 `false`（调用方可不阻断，依赖 NSIS hook）。
pub fn shutdown_and_wait(app: &AppHandle, timeout: Duration) -> bool {
    info!("正在关闭 corex-daemon…");

    match ipc::shutdown() {
        Ok(()) => info!("已发送 corex-daemon IPC shutdown"),
        Err(e) => warn!("corex-daemon IPC shutdown 失败（可忽略）: {e}"),
    }

    let state = app.try_state::<SidecarState>();
    let child = state
        .as_ref()
        .and_then(|s| s.child.lock().ok().and_then(|mut guard| guard.take()));

    let start = Instant::now();
    let stopped = if let Some(child) = child {
        stop_child(child, timeout, start)
    } else {
        wait_until_pipe_closed(timeout, start)
    };

    if let Some(state) = state.as_ref() {
        state.fail();
    }

    if stopped {
        std::thread::sleep(HANDLE_SETTLE);
        info!("corex-daemon 已停止");
    } else {
        warn!(
            "corex-daemon 在 {:?} 内未确认退出，将依赖安装器 hook 兜底",
            timeout
        );
    }

    stopped
}

fn stop_child(child: CommandChild, timeout: Duration, start: Instant) -> bool {
    let pid = child.pid();

    let graceful = GRACEFUL_WAIT.min(timeout);
    if wait_for_pid_exit(pid, graceful) {
        info!("corex-daemon 已优雅退出 (pid={pid})");
        return true;
    }

    match child.kill() {
        Ok(()) => info!("已请求终止 corex-daemon (pid={pid})"),
        Err(e) => warn!("kill corex-daemon 失败 (pid={pid}): {e}"),
    }

    let remaining = timeout.saturating_sub(start.elapsed());
    if wait_for_pid_exit(pid, remaining) {
        info!("corex-daemon 已退出 (pid={pid})");
        return true;
    }

    warn!("等待 corex-daemon 退出超时 (pid={pid})");
    false
}

fn wait_until_pipe_closed(timeout: Duration, start: Instant) -> bool {
    // shutdown() 已丢弃长连接；此处用短暂探测，不重建 SESSION。
    while start.elapsed() < timeout {
        if !ipc::is_listening() {
            info!("corex-daemon IPC 已不可用");
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !ipc::is_listening()
}

#[cfg(windows)]
fn wait_for_pid_exit(pid: u32, timeout: Duration) -> bool {
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
    };

    let handle = match unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) } {
        Ok(h) => h,
        Err(_) => {
            // 进程已不存在
            return true;
        }
    };

    let ms = timeout.as_millis().min(u32::MAX as u128) as u32;
    let result = unsafe { WaitForSingleObject(handle, ms) };
    let _ = unsafe { CloseHandle(handle) };

    match result {
        WAIT_OBJECT_0 => true,
        WAIT_TIMEOUT => false,
        other => {
            warn!("WaitForSingleObject(pid={pid}) 异常: {other:?}");
            false
        }
    }
}

#[cfg(not(windows))]
fn wait_for_pid_exit(_pid: u32, timeout: Duration) -> bool {
    std::thread::sleep(timeout.min(Duration::from_millis(200)));
    true
}
