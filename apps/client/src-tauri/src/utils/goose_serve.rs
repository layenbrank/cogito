//! goose serve sidecar：TLS ACP 后端生命周期与连接信息。
//!
//! 为什么这里**不做**「闲置自动退出」：它是单例后端（一个进程服务所有会话），
//! 进程数不随使用时间增长；而 ACP 是长连接，按闲置杀掉会在切线程 / 重连的瞬间
//! 打断正在进行的回合。宿主退出时由 `child_job` 的 Job Object 连带收掉，不留孤儿。
//! 与终端 PTY 不同 —— 那边每个 cwd 一个 shell，才需要 `start_idle_reaper`。

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
const STATUS_EVENT: &str = "goose://status";

/// 就绪状态事件（S4）：`goose://status` 的载荷，也是前端 `waitGooseReady` 的唯一信号源。
///
/// `goose:ready` 命令保留成**兜底**（事件可能早于订阅发出、监听也可能注册失败），
/// 但状态机的真值只在这里产生一次；前端用 `shared/ipc/specs/gooseStatus.ts` 解析同一份结构，
/// 两边字段漂移会被单测抓住。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GooseStatus {
    /// `starting` / `ready` / `failed`
    pub state: &'static str,
    /// spawn → 就绪的毫秒数（`ready` 时才有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_ms: Option<u64>,
    /// 宿主进程 RSS（S10 并行会话的容量基线）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rss_bytes: Option<u64>,
    /// goose serve 子进程 RSS
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goose_rss_bytes: Option<u64>,
    /// 失败原因（`failed` 时才有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn emit_status(app: &AppHandle, status: GooseStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, &status) {
        warn!("发送 goose 状态事件失败: {error}");
    }
}

/// 宿主 / 子进程的常驻内存（`pid=None` 表示当前进程）。
#[cfg(windows)]
fn rss_bytes_of(pid: Option<u32>) -> Option<u64> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let mut counters = PROCESS_MEMORY_COUNTERS::default();
    let opened = match pid {
        Some(pid) => {
            Some(unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?)
        }
        None => None,
    };
    let handle = opened.unwrap_or_else(|| unsafe { GetCurrentProcess() });
    let ok = unsafe {
        GetProcessMemoryInfo(
            handle,
            &mut counters,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    };
    if let Some(handle) = opened {
        let _ = unsafe { CloseHandle(handle) };
    }
    ok.is_ok().then_some(counters.WorkingSetSize as u64)
}

#[cfg(not(windows))]
fn rss_bytes_of(_pid: Option<u32>) -> Option<u64> {
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GooseConnection {
    pub url: String,
    // 令牌不出进程（S2）：连接信息里只有带 token 的 url，不再单列一份明文
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
        emit_status(
            &app,
            GooseStatus {
                state: "starting",
                ready_ms: None,
                rss_bytes: None,
                goose_rss_bytes: None,
                reason: None,
            },
        );
        if let Err(error) = spawn_inner(&app).await {
            tracing::error!("goose serve 启动失败: {error}");
            if let Some(state) = app.try_state::<GooseServeState>() {
                state.fail();
            }
            let _ = app.emit("goose://not-ready", ());
            emit_status(
                &app,
                GooseStatus {
                    state: "failed",
                    ready_ms: None,
                    rss_bytes: rss_bytes_of(None),
                    goose_rss_bytes: None,
                    reason: Some(error.clone()),
                },
            );
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

    let started = Instant::now();
    let command = build_goose_command(app, &args, &token)?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("启动 goose serve 失败: {e}"))?;

    // 同上：宿主被强杀时 goose 也不能留成孤儿
    let child_pid = child.pid();
    crate::utils::child_job::adopt(child_pid, "goose serve");

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
    let mut last_probe_error: Option<String> = None;
    let mut last_probe_warn_at: Option<Instant> = None;
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
                    match probe_status(port, fp).await {
                        Ok(()) => {
                            let connection = GooseConnection {
                                url: build_acp_url(port, &token),
                                // 令牌不出进程：只保留带 token 的 url
                                port,
                                cert_fingerprint: fp.clone(),
                            };
                            app.state::<GooseServeState>().mark_ready(connection);
                            let ready_ms = started.elapsed().as_millis() as u64;
                            let status = GooseStatus {
                                state: "ready",
                                ready_ms: Some(ready_ms),
                                rss_bytes: rss_bytes_of(None),
                                goose_rss_bytes: rss_bytes_of(Some(child_pid)),
                                reason: None,
                            };
                            info!(
                                ready_ms,
                                rss_mb = status.rss_bytes.map(|b| b / 1024 / 1024),
                                goose_rss_mb = status.goose_rss_bytes.map(|b| b / 1024 / 1024),
                                "goose 就绪基线"
                            );
                            emit_status(app, status);
                            watch_process(app.clone(), rx);
                            return Ok(());
                        }
                        Err(error) => {
                            last_probe_error = Some(error.clone());
                            // 150ms 一轮，勿每轮 warn；约 2s 打一次便于对照
                            let should_warn = last_probe_warn_at
                                .map(|at| at.elapsed() >= Duration::from_secs(2))
                                .unwrap_or(true);
                            if should_warn {
                                warn!("goose /status 探活未通过 (port={port}): {error}");
                                last_probe_warn_at = Some(Instant::now());
                            }
                        }
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
        "goose serve 在 {:?} 内未就绪（fingerprint={}{}）",
        READY_TIMEOUT,
        fingerprint.is_some(),
        last_probe_error
            .as_deref()
            .map(|e| format!(", last_error={e}"))
            .unwrap_or_default()
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
                let command = app
                    .shell()
                    .command(trimmed)
                    .args(args.iter().copied())
                    .env("GOOSE_SERVER__SECRET_KEY", token)
                    .env("GOOSE_PATH_ROOT", &path_root);
                return Ok(with_cli_envs(command));
            }
        }
    }

    let command = app
        .shell()
        .sidecar("goose")
        .map_err(|e| format!("创建 goose sidecar 失败: {e}"))?
        .args(args.iter().copied())
        .env("GOOSE_SERVER__SECRET_KEY", token)
        .env("GOOSE_PATH_ROOT", &path_root);
    Ok(with_cli_envs(command))
}

/// 注入侧车要继承的环境变量：Cursor CLI 的 PATH / CURSOR_API_KEY，
/// 以及**归一后的** `OLLAMA_HOST`（见 `normalize_ollama_host`）。
fn with_cli_envs(
    mut command: tauri_plugin_shell::process::Command,
) -> tauri_plugin_shell::process::Command {
    for (key, value) in crate::utils::cursor_agent::goose_cli_envs() {
        command = command.env(key, value);
    }
    if let Ok(raw) = std::env::var("OLLAMA_HOST") {
        if let Some(normalized) = normalize_ollama_host(&raw) {
            info!("OLLAMA_HOST 归一：{} → {}", raw.trim(), normalized);
            command = command.env("OLLAMA_HOST", normalized);
        }
    }
    command
}

/// 把 Ollama 的监听地址改成**能拨号**的地址。
///
/// 用户常把 `OLLAMA_HOST` 设成 `0.0.0.0`（那是服务端监听写法），而 goose 的 ollama
/// provider 拿它当**请求地址**，拼出 `http://0.0.0.0/v1/chat/completions`（无端口 = 80）
/// —— 本机一定连不上，还会被代理吞成 502。
///
/// 只改写两种情况：通配地址（`0.0.0.0` / `::` / `*`）和缺端口；其余原样透传（`None`）。
fn normalize_ollama_host(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() {
        return None;
    }
    let (scheme, rest) = match text.split_once("://") {
        Some((scheme, rest)) => (Some(scheme), rest),
        None => (None, text),
    };
    let (host, port) = split_host_port(rest);
    let is_wildcard = matches!(host, "0.0.0.0" | "::" | "*");
    if !is_wildcard {
        // 能拨号（带端口）的行不动；IPv6 无端口不猜，免得拼出非法地址
        if port.is_some() || host.contains(':') {
            return None;
        }
    }
    let target_host = if is_wildcard { "127.0.0.1" } else { host };
    let target_port = port.unwrap_or("11434");
    Some(match scheme {
        Some(scheme) => format!("{scheme}://{target_host}:{target_port}"),
        None => format!("{target_host}:{target_port}"),
    })
}

/// `host:port` / `[::]:11434` / `[::]` / `host` 四种形态拆开；无端口时返回 `(host, None)`。
fn split_host_port(value: &str) -> (&str, Option<&str>) {
    if let Some(inner) = value.strip_prefix('[') {
        return match inner.split_once("]:") {
            Some((host, port)) => (host, Some(port)),
            None => (inner.strip_suffix(']').unwrap_or(inner), None),
        };
    }
    match value.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => (host, Some(port)),
        _ => (value, None),
    }
}

/// 跑一次 goose 子命令并收集输出（`schedule` 这类一次性命令用）。
///
/// 复用 serve 的二进制解析与 `GOOSE_PATH_ROOT`：goose 的调度数据因此落在应用自己的
/// `<appData>/goose` 下，不会和用户全局安装的 goose 混在一起。
pub async fn run_goose(app: &AppHandle, args: &[&str]) -> Result<String, String> {
    // 一次性命令不需要密钥，但 build 要一个值；用完即弃
    let token = random_token();
    let command = build_goose_command(app, args, &token)?;
    let (mut rx, _child) = command
        .spawn()
        .map_err(|e| format!("启动 goose 失败: {e}"))?;

    crate::utils::child_job::adopt(_child.pid(), "goose");

    let mut stdout = String::new();
    let mut stderr = String::new();
    let mut code: Option<i32> = None;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => stdout.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Stderr(bytes) => stderr.push_str(&String::from_utf8_lossy(&bytes)),
            CommandEvent::Terminated(payload) => {
                code = payload.code;
                break;
            }
            _ => {}
        }
    }

    if code == Some(0) {
        Ok(stdout)
    } else {
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(format!(
            "goose {} 失败（exit={code:?}）：{detail}",
            args.join(" ")
        ))
    }
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
                emit_status(
                    &app,
                    GooseStatus {
                        state: "failed",
                        ready_ms: None,
                        rss_bytes: rss_bytes_of(None),
                        goose_rss_bytes: None,
                        reason: Some(format!(
                            "goose serve 已退出 (code={:?}, signal={:?})",
                            payload.code, payload.signal
                        )),
                    },
                );
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

async fn probe_status(port: u16, fingerprint: &str) -> Result<(), String> {
    crate::utils::goose_tls::https_status_ok(port, fingerprint).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 前端按这个 JSON 解析（`shared/ipc/specs/gooseStatus.ts` 的 zod），
    /// 字段名漂移会在这里先炸，而不是在真机上表现成「一直转圈」。
    #[test]
    fn ready_status_is_camel_case_and_carries_baseline() {
        let value = serde_json::to_value(GooseStatus {
            state: "ready",
            ready_ms: Some(1234),
            rss_bytes: Some(1024),
            goose_rss_bytes: Some(2048),
            reason: None,
        })
        .expect("json");

        assert_eq!(value["state"], serde_json::json!("ready"));
        assert_eq!(value["readyMs"], serde_json::json!(1234));
        assert_eq!(value["rssBytes"], serde_json::json!(1024));
        assert_eq!(value["gooseRssBytes"], serde_json::json!(2048));
        assert!(value.get("reason").is_none(), "{value}");
    }

    #[test]
    fn starting_status_omits_optional_fields() {
        let value = serde_json::to_value(GooseStatus {
            state: "starting",
            ready_ms: None,
            rss_bytes: None,
            goose_rss_bytes: None,
            reason: None,
        })
        .expect("json");
        assert_eq!(value.as_object().expect("obj").len(), 1, "{value}");
    }

    /// 状态机三态（启动中 / 就绪 / 失败）与重启复位
    #[test]
    fn serve_state_machine_settles_and_resets() {
        let state = GooseServeState::new();
        assert!(state.status().is_none());
        assert!(!state.is_ready());

        state.mark_ready(GooseConnection {
            url: "wss://127.0.0.1:1/acp?token=t".to_string(),
            port: 1,
            cert_fingerprint: "ff".to_string(),
        });
        assert!(state.is_ready());
        assert_eq!(state.status(), Some(true));
        assert!(state.connection().is_some());

        state.fail();
        assert_eq!(state.status(), Some(false));
        assert!(!state.is_ready());
        assert!(state.connection().is_none());

        state.reset_for_restart();
        assert!(state.status().is_none());
    }

    #[test]
    fn fingerprint_is_normalized_to_lowercase_hex() {
        assert_eq!(normalize_fingerprint("AB:cd:EF 12"), "abcdef12");
    }

    /// 通配地址是「监听」写法，当请求地址用时必须换成回环
    #[test]
    fn ollama_host_wildcard_becomes_loopback() {
        assert_eq!(
            normalize_ollama_host("0.0.0.0").as_deref(),
            Some("127.0.0.1:11434")
        );
        assert_eq!(
            normalize_ollama_host("0.0.0.0:11500").as_deref(),
            Some("127.0.0.1:11500")
        );
        assert_eq!(
            normalize_ollama_host("http://0.0.0.0:11434").as_deref(),
            Some("http://127.0.0.1:11434")
        );
        assert_eq!(
            normalize_ollama_host("[::]").as_deref(),
            Some("127.0.0.1:11434")
        );
    }

    /// 本来就能拨号的地址一律不改
    #[test]
    fn ollama_host_keeps_usable_values() {
        assert_eq!(normalize_ollama_host("127.0.0.1:11434"), None);
        assert_eq!(normalize_ollama_host("http://192.168.1.9:11434"), None);
        assert_eq!(normalize_ollama_host("[::1]:11434"), None);
        assert_eq!(normalize_ollama_host("  "), None);
        // 只有主机名时补默认端口（goose 不接受无端口的 host）
        assert_eq!(
            normalize_ollama_host("myhost").as_deref(),
            Some("myhost:11434")
        );
    }
}
