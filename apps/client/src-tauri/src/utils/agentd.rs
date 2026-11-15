//! agentd sidecar：编排层宿主（Node SEA）的生命周期、连接信息与状态事件。
//!
//! 与 `goose_serve` 的分工变了：goose **不再由 Rust 托管**，而是由 agentd 以 stdio ACP
//! 拉起来（见 ADR `agent-orchestration-langgraph.md`）。所以 Rust 这边只剩一个子进程要管。
//!
//! 三个硬约束：
//! - **端口由 agentd 自己 `bind(0)`，经 stdout 握手行回报**（`AGENTD_READY {json}`）。
//!   Rust 不预探空闲端口再传进来 —— 那是 TOCTOU。
//! - 令牌由 Rust 生成、只经环境变量下传；`/health` 之外的端点全部要 Bearer。
//! - 本机回环 HTTP **必须 no_proxy**：reqwest 会读 Windows 系统代理，走代理时本机请求回 502。
//!
//! 崩溃自愈：agentd 非预期退出时自动重启，上限 [`MAX_RESTARTS`] 次（计数跨重启累计，
//! 手动 `agentd:restart` 才清零）。

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tracing::{info, warn};

/// `/health` 回包里的服务名：用来确认端口上跑的确实是 agentd，而不是别人的同名端口。
pub const SERVICE_NAME: &str = "cogito-agentd";

const READY_PREFIX: &str = "AGENTD_READY ";
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const PROBE_INTERVAL: Duration = Duration::from_millis(150);
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
const EXIT_WAIT: Duration = Duration::from_secs(5);
const MAX_RESTARTS: u32 = 3;
const RESTART_BACKOFF: Duration = Duration::from_millis(500);
/// 令牌字节数（hex 编码后 64 字符，远超 agentd 的 16 字符下限）。
const TOKEN_BYTES: usize = 32;

const STATUS_EVENT: &str = "agentd://status";
const NOT_READY_EVENT: &str = "agentd://not-ready";

/// `agentd://status` 载荷。前端用 `shared/ipc/specs/agentdStatus.ts` 解析同一份结构，
/// 字段漂移会被单测抓住（与 `GooseStatus` 同样的做法）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentdStatus {
    /// `starting` / `ready` / `failed`
    pub state: &'static str,
    /// spawn → 就绪的毫秒数（`ready` 时才有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ready_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// agentd 视角的 goose 状态：`disabled` / `starting` / `ready` / `failed`
    #[serde(skip_serializing_if = "Option::is_none")]
    pub goose: Option<String>,
    /// 已发生的自动重启次数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restarts: Option<u32>,
    /// 失败原因（`failed` 时才有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 前端连 agentd 需要的一切（`agentd:endpoint` 的返回）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentdEndpoint {
    pub base_url: String,
    pub port: u16,
    pub pid: u32,
    pub version: String,
    /// Bearer 令牌；`/health` 之外都要带
    pub token: String,
}

/// stdout 握手行载荷（agentd `main.ts` 打的 `AGENTD_READY {...}`）。
#[derive(Debug, Deserialize)]
struct ReadyHandshake {
    port: u16,
    #[serde(default)]
    pid: u32,
}

/// `/health` 回包里本模块关心的字段（其余字段忽略，免得 agentd 加字段就炸）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HealthPayload {
    service: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    pid: u32,
    #[serde(default)]
    goose: String,
    #[serde(default)]
    restarts: u32,
}

pub struct AgentdState {
    ready: AtomicBool,
    settled: AtomicBool,
    /// 主动停机中：抑制「退出 → 自动重启」这条链
    stopping: AtomicBool,
    restarts: AtomicU32,
    token: Mutex<Option<String>>,
    endpoint: Mutex<Option<AgentdEndpoint>>,
    child: Mutex<Option<CommandChild>>,
}

impl Default for AgentdState {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentdState {
    pub fn new() -> Self {
        Self {
            ready: AtomicBool::new(false),
            settled: AtomicBool::new(false),
            stopping: AtomicBool::new(false),
            restarts: AtomicU32::new(0),
            token: Mutex::new(None),
            endpoint: Mutex::new(None),
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

    pub fn endpoint(&self) -> Option<AgentdEndpoint> {
        self.endpoint.lock().ok()?.clone()
    }

    pub fn restarts(&self) -> u32 {
        self.restarts.load(Ordering::Relaxed)
    }

    fn mark_ready(&self, endpoint: AgentdEndpoint) {
        if let Ok(mut guard) = self.endpoint.lock() {
            *guard = Some(endpoint);
        }
        self.ready.store(true, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
    }

    pub fn fail(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.settled.store(true, Ordering::Relaxed);
        if let Ok(mut guard) = self.endpoint.lock() {
            *guard = None;
        }
    }

    fn reset_for_restart(&self) {
        self.ready.store(false, Ordering::Relaxed);
        self.settled.store(false, Ordering::Relaxed);
        if let Ok(mut guard) = self.endpoint.lock() {
            *guard = None;
        }
        if let Ok(mut guard) = self.child.lock() {
            *guard = None;
        }
    }

    fn take_child(&self) -> Option<CommandChild> {
        self.child.lock().ok().and_then(|mut guard| guard.take())
    }

    /// 令牌只生成一次：agentd 重启后前端不必重新取 endpoint 的 token 字段。
    fn ensure_token(&self) -> Result<String, String> {
        let mut guard = self.token.lock().map_err(|e| format!("锁定 agentd token 失败: {e}"))?;
        if let Some(token) = guard.as_ref() {
            return Ok(token.clone());
        }
        let mut bytes = [0u8; TOKEN_BYTES];
        rand::rng().fill_bytes(&mut bytes);
        let token = hex::encode(bytes);
        *guard = Some(token.clone());
        Ok(token)
    }
}

fn emit_status(app: &AppHandle, status: AgentdStatus) {
    if let Err(error) = app.emit(STATUS_EVENT, &status) {
        warn!("发送 agentd 状态事件失败: {error}");
    }
}

fn starting_status() -> AgentdStatus {
    AgentdStatus {
        state: "starting",
        ready_ms: None,
        port: None,
        pid: None,
        goose: None,
        restarts: None,
        reason: None,
    }
}

/// 宿主 / 子进程的常驻内存（与 `goose_serve` 同一套 FFI，`pid=None` 表示当前进程）。
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

/// 启动 agentd，并在后台等到就绪；失败发 `agentd://not-ready`。
pub fn spawn_and_watch(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_until_ready(&app).await;
    });
}

async fn run_until_ready(app: &AppHandle) {
    emit_status(app, starting_status());
    match spawn_once(app).await {
        Ok(()) => info!("agentd 已就绪"),
        Err(error) => {
            tracing::error!("agentd 启动失败: {error}");
            if let Some(state) = app.try_state::<AgentdState>() {
                state.fail();
            }
            let _ = app.emit(NOT_READY_EVENT, ());
            emit_status(
                app,
                AgentdStatus {
                    state: "failed",
                    ready_ms: None,
                    port: None,
                    pid: None,
                    goose: None,
                    restarts: Some(restarts_of(app)),
                    reason: Some(error),
                },
            );
        }
    }
}

fn restarts_of(app: &AppHandle) -> u32 {
    app.try_state::<AgentdState>()
        .map(|state| state.restarts())
        .unwrap_or(0)
}

async fn spawn_once(app: &AppHandle) -> Result<(), String> {
    let token = app
        .try_state::<AgentdState>()
        .ok_or_else(|| "agentd 状态未注册".to_string())?
        .ensure_token()?;

    let started = Instant::now();
    let command = build_command(app, &token)?;
    let (mut rx, child) = command
        .spawn()
        .map_err(|error| format!("启动 agentd 失败: {error}"))?;

    // 宿主被强杀（无 RunEvent::Exit）时靠 Job Object 连带回收
    let child_pid = child.pid();
    crate::utils::child_job::adopt(child_pid, "agentd");

    {
        let state = app.state::<AgentdState>();
        let mut guard = state
            .child
            .lock()
            .map_err(|error| format!("锁定 agentd 状态失败: {error}"))?;
        *guard = Some(child);
    }

    let mut buffer = String::new();
    let mut handshake: Option<ReadyHandshake> = None;
    let mut last_probe_error: Option<String> = None;
    let mut last_warn_at: Option<Instant> = None;
    let deadline = Instant::now() + READY_TIMEOUT;

    while Instant::now() < deadline {
        tokio::select! {
            event = rx.recv() => {
                match event {
                    Some(CommandEvent::Stdout(bytes)) => {
                        buffer.push_str(&String::from_utf8_lossy(&bytes));
                        if let Some(ready) = take_ready_line(&mut buffer) {
                            // 交叉校验：握手行里的 pid 应该是我们刚 spawn 的那个
                            if ready.pid != 0 && ready.pid != child_pid {
                                warn!(
                                    "agentd 握手行 pid({}) 与 spawn 的 pid({child_pid}) 不一致",
                                    ready.pid
                                );
                            }
                            info!(port = ready.port, pid = child_pid, "agentd 握手行已收到");
                            handshake = Some(ready);
                        }
                    }
                    Some(CommandEvent::Stderr(bytes)) => {
                        let line = String::from_utf8_lossy(&bytes);
                        // agentd 的 stderr 大部分是日志，只在像错误时透出
                        if line.contains("Error") || line.contains("error:") || line.contains("panic")
                        {
                            warn!("agentd stderr: {}", line.trim_end());
                        }
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        return Err(format!(
                            "agentd 在就绪前退出 (code={:?}, signal={:?})",
                            payload.code, payload.signal
                        ));
                    }
                    Some(_) => {}
                    None => return Err("agentd 输出通道已关闭".into()),
                }
            }
            _ = tokio::time::sleep(PROBE_INTERVAL) => {
                let Some(port) = handshake.as_ref().map(|ready| ready.port) else { continue };
                match probe_health(port).await {
                    Ok(health) => {
                        let endpoint = AgentdEndpoint {
                            base_url: format!("http://127.0.0.1:{port}"),
                            port,
                            pid: if health.pid == 0 { child_pid } else { health.pid },
                            version: health.version.clone(),
                            token: token.clone(),
                        };
                        let ready_ms = started.elapsed().as_millis() as u64;
                        let restarts = restarts_of(app);
                        let endpoint_pid = endpoint.pid;
                        app.state::<AgentdState>().mark_ready(endpoint);
                        info!(
                            ready_ms,
                            port,
                            goose = %health.goose,
                            restarts,
                            rss_mb = rss_bytes_of(None).map(|b| b / 1024 / 1024),
                            agentd_rss_mb = rss_bytes_of(Some(child_pid)).map(|b| b / 1024 / 1024),
                            version = %health.version,
                            "agentd 就绪基线"
                        );
                        emit_status(app, AgentdStatus {
                            state: "ready",
                            ready_ms: Some(ready_ms),
                            port: Some(port),
                            pid: Some(endpoint_pid),
                            goose: Some(health.goose),
                            restarts: Some(health.restarts.max(restarts)),
                            reason: None,
                        });
                        watch_process(app.clone(), rx);
                        return Ok(());
                    }
                    Err(error) => {
                        last_probe_error = Some(error.clone());
                        // 150ms 一轮，别每轮都 warn
                        let should_warn = last_warn_at
                            .map(|at| at.elapsed() >= Duration::from_secs(2))
                            .unwrap_or(true);
                        if should_warn {
                            warn!("agentd /health 探活未通过 (port={port}): {error}");
                            last_warn_at = Some(Instant::now());
                        }
                    }
                }
            }
        }
    }

    Err(format!(
        "agentd 在 {READY_TIMEOUT:?} 内未就绪（handshake={}{}）",
        handshake.is_some(),
        last_probe_error
            .as_deref()
            .map(|error| format!(", last_error={error}"))
            .unwrap_or_default()
    ))
}

/// 进程退出后的收尾：非预期退出则按上限自动重启。
fn watch_process(app: AppHandle, mut rx: tauri::async_runtime::Receiver<CommandEvent>) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            let CommandEvent::Terminated(payload) = event else {
                continue;
            };
            warn!(
                "agentd 已退出 (code={:?}, signal={:?})",
                payload.code, payload.signal
            );

            let Some(state) = app.try_state::<AgentdState>() else {
                return;
            };
            let stopping = state.stopping.swap(false, Ordering::Relaxed);
            state.fail();
            if let Ok(mut guard) = state.child.lock() {
                *guard = None;
            }

            if stopping {
                info!("agentd 已按请求停止");
                return;
            }

            let attempt = state.restarts.fetch_add(1, Ordering::Relaxed) + 1;
            let _ = app.emit(NOT_READY_EVENT, ());
            emit_status(
                &app,
                AgentdStatus {
                    state: "failed",
                    ready_ms: None,
                    port: None,
                    pid: None,
                    goose: None,
                    restarts: Some(attempt),
                    reason: Some(format!(
                        "agentd 已退出 (code={:?}, signal={:?})",
                        payload.code, payload.signal
                    )),
                },
            );

            if attempt > MAX_RESTARTS {
                tracing::error!("agentd 连续退出 {attempt} 次，停止自动重启");
                return;
            }

            info!("agentd 将在 {RESTART_BACKOFF:?} 后自动重启（第 {attempt} 次）");
            tokio::time::sleep(RESTART_BACKOFF).await;
            state.reset_for_restart();
            run_until_ready(&app).await;
            return;
        }
    });
}

/// 拼 agentd 的启动命令。
///
/// 三种来源，优先级从高到低：
/// 1. `AGENTD_BINARY`（debug）：直接执行该路径（SEA 单文件产物）；
/// 2. `AGENTD_ENTRY`（debug）：`node <entry>`，给 `pnpm dev` 用，免得每次都打 SEA；
/// 3. `sidecar("agentd")`：正式包里的 `agentd-<triple>.exe`。
fn build_command(
    app: &AppHandle,
    token: &str,
) -> Result<tauri_plugin_shell::process::Command, String> {
    let db_path = agentd_db_path(app)?;
    if let Some(dir) = db_path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|error| format!("创建 agentd 数据目录失败 ({}): {error}", dir.display()))?;
    }
    let goose_root = goose_path_root(app)?;
    std::fs::create_dir_all(&goose_root)
        .map_err(|error| format!("创建 goose 配置根失败 ({goose_root}): {error}"))?;

    let base = base_command(app)?;
    let mut command = base
        .env("AGENTD_TOKEN", token)
        // 端口交给内核分配；Rust 只认握手行里的值
        .env("AGENTD_PORT", "0")
        .env("AGENTD_DB", db_path.to_string_lossy().into_owned())
        .env("AGENTD_GOOSE_PATH_ROOT", goose_root)
        .env(
            "AGENTD_VERSION",
            app.package_info().version.to_string(),
        )
        .env(
            "AGENTD_ISOLATED",
            if crate::utils::instance::isolated() {
                "1"
            } else {
                "0"
            },
        )
        .env("NO_COLOR", "1");

    if let Some(binary) = goose_binary_path() {
        command = command.env("AGENTD_GOOSE_BINARY", binary);
    }
    Ok(command)
}

fn base_command(app: &AppHandle) -> Result<tauri_plugin_shell::process::Command, String> {
    #[cfg(debug_assertions)]
    {
        if let Ok(raw) = std::env::var("AGENTD_BINARY") {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                info!("使用 AGENTD_BINARY={trimmed}");
                return Ok(app.shell().command(trimmed));
            }
        }
        if let Ok(raw) = std::env::var("AGENTD_ENTRY") {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                info!("使用 AGENTD_ENTRY={trimmed}（node 直跑）");
                return Ok(app.shell().command("node").args([trimmed]));
            }
        }
        // tauri dev 不复制 externalBin：直接认源仓库里那份（`apps/client/src-tauri/binaries`）
        if let Some(path) = staged_binary_path("agentd") {
            info!("使用仓库内 agentd 产物 {path}");
            return Ok(app.shell().command(path));
        }
    }

    app.shell()
        .sidecar("agentd")
        .map_err(|error| format!("创建 agentd sidecar 失败: {error}"))
}

/// 仓库内已构建的侧车：`<CARGO_MANIFEST_DIR>/binaries/<name>-<triple>[.exe]`。
///
/// 仅 debug 使用 —— 正式包里侧车与宿主同目录，由 `sidecar()` 解析。
fn staged_binary_path(name: &str) -> Option<String> {
    let triple = tauri::utils::platform::target_triple().ok()?;
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "{name}-{triple}{}",
            std::env::consts::EXE_SUFFIX
        ));
    path.is_file()
        .then(|| path.to_string_lossy().into_owned())
}

/// `<appLocalData>/agentd/agentd.db`（`instance` 隔离由 identifier 派生，dev 天然分开）。
fn agentd_db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    Ok(base.join("agentd").join("agentd.db"))
}

/// goose 的 `config/data/state` 根：`<appData>/goose`（与 `cogito_provider` 写 provider 的落点一致）。
pub fn goose_path_root(app: &AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;
    Ok(base.join("goose").to_string_lossy().into_owned())
}

/// 打包后的 goose 侧车：与宿主同目录的 `goose-<triple>[.exe]`。
///
/// debug 下优先认 `GOOSE_BINARY`（与 `goose_serve::build_goose_command` 同一套约定），
/// 都找不到时返回 `None`，让 agentd 退回 PATH 里的 `goose`。
fn goose_binary_path() -> Option<String> {
    #[cfg(debug_assertions)]
    if let Ok(raw) = std::env::var("GOOSE_BINARY") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let suffix = std::env::consts::EXE_SUFFIX;
    let mut candidates = Vec::new();
    if let Ok(triple) = tauri::utils::platform::target_triple() {
        candidates.push(dir.join(format!("goose-{triple}{suffix}")));
    }
    candidates.push(dir.join(format!("goose{suffix}")));
    let found = candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    if found.is_some() {
        return found;
    }

    // debug：仓库里 stage 好的那份（`tauri dev` 不会把它复制到 target 目录）
    #[cfg(debug_assertions)]
    return staged_binary_path("goose");

    #[cfg(not(debug_assertions))]
    None
}

/// 从 stdout 缓冲里取 `AGENTD_READY {json}` 行（半行会留在缓冲里等下一批）。
fn take_ready_line(buffer: &mut String) -> Option<ReadyHandshake> {
    loop {
        let newline = buffer.find('\n')?;
        let mut line = buffer.drain(..=newline).collect::<String>();
        if line.ends_with('\n') {
            line.pop();
        }
        if line.ends_with('\r') {
            line.pop();
        }
        let Some(rest) = line.strip_prefix(READY_PREFIX) else {
            continue;
        };
        // 坏行不终止扫描：后面可能还有一条好的握手行（agentd 重启时会出现）
        if let Ok(ready) = serde_json::from_str::<ReadyHandshake>(rest.trim()) {
            return Some(ready);
        }
    }
}

/// `GET /health`：**no_proxy** 是本机侧车的硬要求（系统代理会把回环请求吞成 502）。
async fn probe_health(port: u16) -> Result<HealthPayload, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(HEALTH_TIMEOUT)
        .build()
        .map_err(|error| format!("创建健康检查客户端失败: {error}"))?;
    let url = format!("http://127.0.0.1:{port}/health");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("agentd /health 不可达: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("agentd /health 返回 HTTP {}", response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 /health 响应失败: {error}"))?;
    let payload: HealthPayload = serde_json::from_str(&body)
        .map_err(|error| format!("解析 /health 响应失败: {error}（body={body}）"))?;
    if payload.service != SERVICE_NAME {
        return Err(format!(
            "端口 {port} 上的服务不是 {SERVICE_NAME}（service={}）",
            payload.service
        ));
    }
    Ok(payload)
}

/// 应用退出时关闭 agentd：先请它自己退（`POST /admin/shutdown`），再兜底杀进程树。
pub fn shutdown(app: &AppHandle) {
    let _ = shutdown_and_wait(app, EXIT_WAIT);
}

pub fn shutdown_and_wait(app: &AppHandle, timeout: Duration) -> bool {
    info!("正在关闭 agentd…");
    let Some(state) = app.try_state::<AgentdState>() else {
        return true;
    };
    // 先立旗：请求退出引发的 Terminated 不该触发自动重启
    state.stopping.store(true, Ordering::Relaxed);

    let endpoint = state.endpoint();
    let child = state.take_child();

    let Some(child) = child else {
        state.fail();
        state.stopping.store(false, Ordering::Relaxed);
        return true;
    };
    let pid = child.pid();

    // 优雅路径：agentd 收到 202 后自己 dispose 再 exit
    if let Some(endpoint) = endpoint {
        let url = format!("{}/admin/shutdown", endpoint.base_url);
        let client = reqwest::Client::builder().no_proxy().build();
        if let Ok(client) = client {
            let request = client
                .post(&url)
                .bearer_auth(&endpoint.token)
                .timeout(Duration::from_secs(2))
                .send();
            match tauri::async_runtime::block_on(request) {
                Ok(response) => info!("agentd /admin/shutdown → {}", response.status()),
                Err(error) => warn!("agentd /admin/shutdown 失败（可忽略）: {error}"),
            }
        }
    }

    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(800.min(timeout.as_millis() as u64)) {
        if !is_pid_alive(pid) {
            state.fail();
            state.stopping.store(false, Ordering::Relaxed);
            info!("agentd 已优雅退出 (pid={pid})");
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    kill_tree(pid);
    let _ = child.kill();

    let remaining = timeout.saturating_sub(started.elapsed());
    let deadline = Instant::now() + remaining;
    while Instant::now() < deadline {
        if !is_pid_alive(pid) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let stopped = !is_pid_alive(pid);
    state.fail();
    state.stopping.store(false, Ordering::Relaxed);
    if stopped {
        info!("agentd 已退出 (pid={pid})");
    } else {
        warn!("等待 agentd 退出超时 (pid={pid})");
    }
    stopped
}

/// 手动重启：计数清零，重新拉起并等到就绪。
pub async fn restart(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    tokio::task::spawn_blocking(move || {
        let _ = shutdown_and_wait(&handle, EXIT_WAIT);
    })
    .await
    .map_err(|error| format!("agentd restart shutdown 异常: {error}"))?;

    if let Some(state) = app.try_state::<AgentdState>() {
        state.restarts.store(0, Ordering::Relaxed);
        state.reset_for_restart();
    }
    spawn_and_watch(app);

    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(state) = app.try_state::<AgentdState>() {
            if state.is_ready() {
                return Ok(());
            }
            if let Some(false) = state.status() {
                return Err("agentd 重启失败".into());
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    Err("agentd 重启超时".into())
}

/// 重启内层 goose（agentd 崩了不必重启，goose 崩了才需要）。
pub async fn restart_goose(app: &AppHandle) -> Result<(), String> {
    let endpoint = app
        .try_state::<AgentdState>()
        .and_then(|state| state.endpoint())
        .ok_or_else(|| "agentd 未就绪".to_string())?;

    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("创建请求客户端失败: {error}"))?;
    let response = client
        .post(format!("{}/admin/goose/restart", endpoint.base_url))
        .bearer_auth(&endpoint.token)
        .send()
        .await
        .map_err(|error| format!("请求 agentd 重启 goose 失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "agentd /admin/goose/restart 返回 HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new("taskkill")
        .args(["/pid", &pid.to_string(), "/f", "/t"])
        .creation_flags(0x0800_0000)
        .status();
}

#[cfg(not(windows))]
fn kill_tree(_pid: u32) {}

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
fn is_pid_alive(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{pid}")).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_line_is_parsed_from_partial_chunks() {
        let mut buffer = String::from("noise line\nAGENTD_READY {\"port\":54");
        assert!(take_ready_line(&mut buffer).is_none());
        buffer.push_str("183,\"pid\":1234}\n");
        let ready = take_ready_line(&mut buffer).expect("handshake");
        assert_eq!(ready.port, 54183);
        assert_eq!(ready.pid, 1234);
    }

    #[test]
    fn ready_line_tolerates_crlf_and_bad_json() {
        let mut buffer = String::from("AGENTD_READY {\"port\":1}\r\n");
        assert_eq!(take_ready_line(&mut buffer).expect("handshake").port, 1);

        let mut broken = String::from("AGENTD_READY {oops\nAGENTD_READY {\"port\":7}\n");
        assert_eq!(take_ready_line(&mut broken).expect("handshake").port, 7);
    }

    /// 前端（`shared/ipc/specs/agentdStatus.ts`）按这个 JSON 解析：字段名漂移在这里先炸
    #[test]
    fn ready_status_is_camel_case_and_omits_empty_fields() {
        let value = serde_json::to_value(AgentdStatus {
            state: "ready",
            ready_ms: Some(1234),
            port: Some(54183),
            pid: Some(99),
            goose: Some("ready".to_string()),
            restarts: Some(0),
            reason: None,
        })
        .expect("json");

        assert_eq!(value["state"], serde_json::json!("ready"));
        assert_eq!(value["readyMs"], serde_json::json!(1234));
        assert_eq!(value["port"], serde_json::json!(54183));
        assert_eq!(value["goose"], serde_json::json!("ready"));
        assert!(value.get("reason").is_none(), "{value}");
    }

    #[test]
    fn starting_status_carries_only_state() {
        let value = serde_json::to_value(starting_status()).expect("json");
        assert_eq!(value.as_object().expect("obj").len(), 1, "{value}");
    }

    /// 状态机：启动中 → 就绪 → 失败 → 重启复位；令牌跨重置复用
    #[test]
    fn state_machine_settles_resets_and_keeps_token() {
        let state = AgentdState::new();
        assert!(state.status().is_none());
        assert!(!state.is_ready());

        let token = state.ensure_token().expect("token");
        assert_eq!(token.len(), TOKEN_BYTES * 2);

        state.mark_ready(AgentdEndpoint {
            base_url: "http://127.0.0.1:1".to_string(),
            port: 1,
            pid: 2,
            version: "0.0.0-test".to_string(),
            token: token.clone(),
        });
        assert!(state.is_ready());
        assert_eq!(state.status(), Some(true));
        assert_eq!(state.endpoint().expect("endpoint").port, 1);

        state.fail();
        assert_eq!(state.status(), Some(false));
        assert!(state.endpoint().is_none());

        state.reset_for_restart();
        assert!(state.status().is_none());
        assert_eq!(state.ensure_token().expect("token"), token);
    }

    /// health 回包只看关心的字段：agentd 加字段不能让宿主解析失败
    #[test]
    fn health_payload_ignores_unknown_fields() {
        let payload: HealthPayload = serde_json::from_str(
            r#"{"service":"cogito-agentd","version":"1.2.3","pid":7,"graphs":["agent"],"goose":"ready","restarts":2,"extra":{"a":1}}"#,
        )
        .expect("parse");
        assert_eq!(payload.service, SERVICE_NAME);
        assert_eq!(payload.goose, "ready");
        assert_eq!(payload.restarts, 2);
    }
}
