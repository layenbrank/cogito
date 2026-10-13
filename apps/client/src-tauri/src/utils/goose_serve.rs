//! goose serve sidecar：TLS ACP 后端生命周期与连接信息。

use std::net::TcpListener;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tracing::{info, warn};

const CERT_FINGERPRINT_PREFIX: &str = "GOOSED_CERT_FINGERPRINT=";
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const FINGERPRINT_TIMEOUT: Duration = Duration::from_secs(5);
const STATUS_INTERVAL: Duration = Duration::from_millis(150);
const EXIT_WAIT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GooseConnection {
    pub url: String,
    pub token: String,
    pub port: u16,
    pub cert_fingerprint: String,
}

pub struct GooseServeState {
    ready: AtomicBool,
    settled: AtomicBool,
    child: Mutex<Option<CommandChild>>,
    connection: Mutex<Option<GooseConnection>>,
}

impl Default for GooseServeState {
    fn default() -> Self {
        Self::new()
    }
}

impl GooseServeState {
    pub fn new() -> Self {
        Self {
            ready: AtomicBool::new(false),
            settled: AtomicBool::new(false),
            child: Mutex::new(None),
            connection: Mutex::new(None),
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

    pub fn connection(&self) -> Option<GooseConnection> {
        self.connection.lock().ok()?.clone()
    }

    fn mark_ready(&self, connection: GooseConnection) {
        if let Ok(mut guard) = self.connection.lock() {
            *guard = Some(connection);
        }
        self.ready.store(true, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
    }

    pub fn fail(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.connection.lock() {
            *guard = None;
        }
    }

    fn reset_for_restart(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.settled.store(false, Ordering::Relaxed);
        if let Ok(mut guard) = self.connection.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.child.lock() {
            *guard = None;
        }
    }
}

pub fn spawn_and_watch(app: &AppHandle, _timeout: Duration) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = spawn_inner(&app).await {
            tracing::error!("goose serve 启动失败: {error}");
            if let Some(state) = app.try_state::<GooseServeState>() {
                state.fail();
            }
            let _ = app.emit("goose://not-ready", ());
        } else {
            info!("goose serve 已就绪");
        }
    });
}

async fn spawn_inner(app: &AppHandle) -> Result<(), String> {
    let token = random_token();
    let port = find_available_port()?;
    let port_text = port.to_string();
    let args = [
        "serve",
        "--tls",
        "--platform",
        "desktop",
        "--enable-scheduler",
        "--host",
        "127.0.0.1",
        "--port",
        port_text.as_str(),
    ];

    let command = build_goose_command(app, &args, &token)?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("启动 goose serve 失败: {e}"))?;

    {
        let state = app.state::<GooseServeState>();
        let mut guard = state
            .child
            .lock()
            .map_err(|e| format!("锁定 goose 状态失败: {e}"))?;
        *guard = Some(child);
    }

    let mut stdout_buffer = String::new();
    let mut fingerprint: Option<String> = None;
    let mut exited = false;
    let deadline = Instant::now() + READY_TIMEOUT;
    let fingerprint_deadline = Instant::now() + FINGERPRINT_TIMEOUT;

    while Instant::now() < deadline {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Some(CommandEvent::Stdout(bytes)) => {
                        stdout_buffer.push_str(&String::from_utf8_lossy(&bytes));
                        if let Some(parsed) = take_fingerprint_line(&mut stdout_buffer) {
                            fingerprint = Some(normalize_fingerprint(&parsed));
                            info!("goose TLS 指纹已收到");
                        }
                    }
                    Some(CommandEvent::Stderr(bytes)) => {
                        let line = String::from_utf8_lossy(&bytes);
                        if line.to_ascii_lowercase().contains("fatal")
                            || line.contains("panicked")
                        {
                            warn!("goose serve stderr: {line}");
                        }
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        exited = true;
                        warn!(
                            "goose serve 已退出 (code={:?}, signal={:?})",
                            payload.code, payload.signal
                        );
                        break;
                    }
                    Some(_) => {}
                    None => {
                        exited = true;
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(STATUS_INTERVAL) => {
                if let Some(ref fp) = fingerprint {
                    if probe_status(port, fp).await {
                        let connection = GooseConnection {
                            url: build_acp_url(port, &token),
                            token: token.clone(),
                            port,
                            cert_fingerprint: fp.clone(),
                        };
                        app.state::<GooseServeState>().mark_ready(connection);
                        watch_process(app.clone(), rx);
                        return Ok(());
                    }
                } else if Instant::now() > fingerprint_deadline {
                    return Err("goose serve 未在时限内输出 GOOSED_CERT_FINGERPRINT".into());
                }
            }
        }
    }

    if exited {
        return Err("goose serve 在就绪前退出".into());
    }
    Err(format!(
        "goose serve 在 {:?} 内未就绪（fingerprint={}）",
        READY_TIMEOUT,
        fingerprint.is_some()
    ))
}

fn build_goose_command(
    app: &AppHandle,
    args: &[&str],
    token: &str,
) -> Result<tauri_plugin_shell::process::Command, String> {
    let path_root = goose_path_root(app)?;
    #[cfg(debug_assertions)]
    {
        if let Ok(path) = std::env::var("GOOSE_BINARY") {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                info!("使用 GOOSE_BINARY={trimmed}");
                return Ok(app
                    .shell()
                    .command(trimmed)
                    .args(args.iter().copied())
                    .env("GOOSE_SERVER__SECRET_KEY", token)
                    .env("GOOSE_PATH_ROOT", &path_root));
            }
        }
    }

    Ok(app
        .shell()
        .sidecar("goose")
        .map_err(|e| format!("创建 goose sidecar 失败: {e}"))?
        .args(args.iter().copied())
        .env("GOOSE_SERVER__SECRET_KEY", token)
        .env("GOOSE_PATH_ROOT", &path_root))
}

/// goose 的 config/data/state 根目录：`<appData>/goose`。
///
/// goose 读 `GOOSE_PATH_ROOT`（须绝对路径）后把 config 落到 `<root>/config`。这样
/// `custom_providers` 与用户全局的 goose 配置完全隔离，也让我们能确定地写声明式 provider。
fn goose_path_root(app: &AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(base.join("goose").to_string_lossy().to_string())
}

fn watch_process(app: AppHandle, mut rx: tauri::async_runtime::Receiver<CommandEvent>) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Terminated(payload) = event {
                warn!(
                    "goose serve 已退出 (code={:?}, signal={:?})",
                    payload.code, payload.signal
                );
                if let Some(state) = app.try_state::<GooseServeState>() {
                    state.fail();
                    if let Ok(mut guard) = state.child.lock() {
                        *guard = None;
                    }
                }
                let _ = app.emit("goose://not-ready", ());
                break;
            }
        }
    });
}

pub fn shutdown(app: &AppHandle) {
    let _ = shutdown_and_wait(app, EXIT_WAIT);
}

pub fn shutdown_and_wait(app: &AppHandle, timeout: Duration) -> bool {
    info!("正在关闭 goose serve…");
    let state = app.try_state::<GooseServeState>();
    let child = state
        .as_ref()
        .and_then(|s| s.child.lock().ok().and_then(|mut guard| guard.take()));

    let stopped = if let Some(child) = child {
        stop_child(child, timeout)
    } else {
        true
    };

    if let Some(state) = state.as_ref() {
        state.fail();
    }
    stopped
}

pub async fn restart(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tokio::task::spawn_blocking({
        let handle = handle.clone();
        move || {
            let _ = shutdown_and_wait(&handle, EXIT_WAIT);
        }
    })
    .await
    .map_err(|e| format!("goose restart shutdown 异常: {e}"))?;

    if let Some(state) = app.try_state::<GooseServeState>() {
        state.reset_for_restart();
    }
    spawn_and_watch(app, READY_TIMEOUT);

    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(state) = app.try_state::<GooseServeState>() {
            if state.is_ready() {
                return Ok(());
            }
            if let Some(false) = state.status() {
                return Err("goose serve 重启失败".into());
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("goose serve 重启超时".into())
}

fn stop_child(child: CommandChild, timeout: Duration) -> bool {
    let pid = child.pid();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("taskkill")
            .args(["/pid", &pid.to_string(), "/f", "/t"])
            .creation_flags(0x0800_0000)
            .status();
    }
    let _ = child.kill();

    let start = Instant::now();
    while start.elapsed() < timeout {
        if !is_pid_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !is_pid_alive(pid)
}

#[cfg(windows)]
fn is_pid_alive(pid: u32) -> bool {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(handle) => {
            let _ = unsafe { CloseHandle(handle) };
            true
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
fn is_pid_alive(_pid: u32) -> bool {
    false
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn find_available_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("分配端口失败: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取端口失败: {e}"))?
        .port();
    Ok(port)
}

fn build_acp_url(port: u16, token: &str) -> String {
    format!("wss://127.0.0.1:{port}/acp?token={token}")
}

fn take_fingerprint_line(buffer: &mut String) -> Option<String> {
    loop {
        let Some(newline) = buffer.find('\n') else {
            return None;
        };
        let mut line = buffer.drain(..=newline).collect::<String>();
        if line.ends_with('\n') {
            line.pop();
        }
        if line.ends_with('\r') {
            line.pop();
        }
        if let Some(rest) = line.strip_prefix(CERT_FINGERPRINT_PREFIX) {
            return Some(rest.trim().to_string());
        }
    }
}

pub fn normalize_fingerprint(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_hexdigit())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

async fn probe_status(port: u16, fingerprint: &str) -> bool {
    crate::utils::goose_tls::https_status_ok(port, fingerprint).await
}
