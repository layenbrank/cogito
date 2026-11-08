//! 嵌入式交互终端：portable-pty 会话管理 + `terminal:*` IPC。
//!
//! 前端 `@xterm/xterm` 渲染，Rust 侧只承担 PTY 主机（对齐 VS Code 的 PtyHost 角色），
//! 实时输出经 `Channel<InvokeResponseBody::Raw>` 推流；attach 历史经返回值 `replay`，
//! 禁止反复 `invoke` 轮询读。
//!
//! 会话与视图**解耦**：会话自己留一段回滚缓冲，视图随时 `terminal:attach` 接上；
//! agent 侧 `terminal:run` 复用同一个会话跑命令并读回输出 —— 这样「点一条命令跳到终端」
//! 看到的确实是它自己的输出，而不是另开一个黑盒 shell。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use portable_pty::{CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;

mod write;
mod guard;

/// 命令下发统一走 `write::submit_command`（就绪哨兵 + 单次写入 + 整条重发）。
use write::submit_command as write_command;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use cogito_command::terminalText::{strip_ansi, tail_chars};

#[cfg(test)]
mod input_tests {
    use super::{echo_confirmed, squeeze};

    #[test]
    fn squeeze_drops_wrapping_whitespace() {
        assert_eq!(squeeze("cargo  test\r\n  -p x"), "cargotest-px");
    }

    #[test]
    fn echo_confirmed_accepts_wrapped_echo() {
        let command = "powershell -NoProfile -Command \"Get-Content a.rs\"";
        let echo = "PS D:\\w> powershell -NoProfile -Command \"Get-Content\r\n a.rs\"";
        assert!(echo_confirmed(echo, command));
    }

    #[test]
    fn echo_confirmed_rejects_swallowed_first_char() {
        // 现场复现：`Remove-Item` 被吞成 `emove-Item`
        let echo = "PS D:\\w> emove-Item .\\x.tmp";
        assert!(!echo_confirmed(echo, "Remove-Item .\\x.tmp"));
    }

    #[test]
    fn echo_confirmed_rejects_swallowed_tail() {
        let command = "node .tmp/verify-assertions.mjs";
        let echo = "PS D:\\w> node .tmp/verify-assertions.mj";
        assert!(!echo_confirmed(echo, command));
    }

    #[test]
    fn echo_confirmed_checks_long_command_head_and_tail() {
        let tail_pad = "x".repeat(80);
        let command = format!("Write-Output {tail_pad} TAILMARKER");
        let wrapped = format!("PS D:\\w> Write-Output\r\n{tail_pad} TAILMARKER");
        assert!(echo_confirmed(&wrapped, &command));
        let broken = format!("PS D:\\w> rite-Output\r\n{tail_pad} TAILMARKER");
        assert!(!echo_confirmed(&broken, &command));
    }
}

#[cfg(test)]
mod idle_tests {
    use super::guard::IDLE_TTL;
    use super::{should_reap, IDLE_CLOSED_TEXT};
    use std::time::Duration;

    /// 四种组合各钉一条：到期空闲才回收，别的都不许动。
    #[test]
    fn reaps_only_idle_agent_sessions() {
        let ttl = IDLE_TTL;
        assert!(should_reap("agent:D:\\w", ttl, false, ttl), "到期且空闲 → 回收");
        assert!(
            !should_reap("agent:D:\\w", ttl - Duration::from_secs(1), false, ttl),
            "没到期 → 不动"
        );
        assert!(
            !should_reap("agent:D:\\w", ttl * 2, true, ttl),
            "有 run 在跑 → 不能被误杀"
        );
        assert!(
            !should_reap("3f9a6ef6-531a", ttl * 2, false, ttl),
            "用户手开的 tab → 永远不回收"
        );
    }

    /// 前端按这段文案写系统行 / 移除 tab，改文案必须同步改前端。
    #[test]
    fn idle_notice_text_is_stable() {
        assert_eq!(IDLE_CLOSED_TEXT, "会话已结束（闲置）");
    }
}

/// 单次读缓冲：终端输出按块推流，8 KiB 在交互吞吐与 IPC 次数间平衡。
const READ_BUF_SIZE: usize = 8192;
/// 回滚缓冲上限：够 agent 读完一次命令的输出，同时不让长跑会话吃满内存。
const SCROLLBACK_MAX_BYTES: usize = 256 * 1024;
/// agent 拿到手的正文上限（字符）：再多也读不动，只会白烧 token。
const RUN_OUTPUT_MAX_CHARS: usize = 12_000;
/// 「跑完了」判据：连续这么久没有新输出即视为结束（shell 无关，不依赖提示符格式）。
const DEFAULT_QUIET_MS: u64 = 700;
/// 单次等待上限：超过就先返回已有输出 + `isRunning: true`，让 agent 自己续读。
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
/// 静默检测的轮询间隔
const POLL_INTERVAL_MS: u64 = 60;
/// 写入前的就绪预算：新会话要等 shell 画出第一帧提示符，老会话也要等它安静下来
/// （上一条命令的提示符可能还在重绘，这期间塞进去的字符会被吞掉）。
const READY_TIMEOUT_MS: u64 = 3_000;
/// 「安静」阈值：这么久没有新输出，才认为 shell 回到可接收输入的状态。
const READY_IDLE_MS: u64 = 120;
/// 就绪轮询间隔
const READY_POLL_MS: u64 = 20;
/// 回显核对失败时的最多尝试次数（含首次）。
const ECHO_ATTEMPTS: usize = 3;
/// Ctrl+C 之后等 shell 把当前行丢弃的时间。
const CANCEL_SETTLE_MS: u64 = 150;
/// 等回显的上限：shell 正忙时输入会被缓冲，给足时间再判死。
const ECHO_MAX_MS: u64 = 3_000;
/// agent 跑命令时广播给前端的事件：让右栏把 tab 打开 / 切过去
/// agent 会话 id 的固定前缀（`agent:<cwd>` 或 `agent:<cwd>#<scope>`）。
const AGENT_ID_PREFIX: &str = "agent:";

/// 闲置会话被关闭时广播的事件：前端据此写系统行并移除 tab。
const IDLE_CLOSED_EVENT: &str = "terminal://idle-closed";

/// 闲置回收扫描间隔。
const REAPER_TICK: Duration = Duration::from_secs(60);

const AGENT_RUN_EVENT: &str = "terminal://agent-run";

/// 会话共享区：回滚缓冲 + 订阅者（可能一个视图都没有）。
struct Scrollback {
    buffer: Vec<u8>,
    /// 因超出上限被丢弃的字节数；绝对游标 = dropped + buffer.len()
    dropped: u64,
    last_output: Instant,
    subscribers: Vec<Channel<InvokeResponseBody>>,
}

impl Scrollback {
    fn new() -> Self {
        Self {
            buffer: Vec::new(),
            dropped: 0,
            last_output: Instant::now(),
            subscribers: Vec::new(),
        }
    }

    /// 绝对游标：跨「缓冲被裁剪」也单调递增，agent 靠它取某次命令之后的输出。
    fn cursor(&self) -> u64 {
        self.dropped + self.buffer.len() as u64
    }
}

struct TerminalSession {
    cwd: String,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    shared: Arc<Mutex<Scrollback>>,
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
    /// 附着时回放的滚动缓冲。走 invoke 返回值，不经 Channel Raw：
    /// 同步 `channel.send(Raw)` 在 WebView2 上常静默失败，表现就是「只有光标、无 profile」。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub replay: Vec<u8>,
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
pub struct TerminalRun {
    pub id: String,
    pub command: String,
    pub output: String,
    /// `true` 表示等到超时还没静下来（如 `npm run dev`），输出只是到目前为止的部分内容
    pub is_running: bool,
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRead {
    pub id: String,
    pub output: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAgentRunEvent {
    pub id: String,
    pub cwd: String,
    pub command: String,
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

/// agent 会话 id 按 cwd 派生：同一目录反复跑命令复用同一个 tab，用户切过去就能接管。
fn agent_session_id(cwd: &str) -> String {
    format!("{AGENT_ID_PREFIX}{cwd}")
}

/// 作用域分隔符：`agent:<cwd>#<scope>`。`#` 不参与路径解析，只做拼接分隔。
const SCOPE_SEP: char = '#';

/// 作用域版会话 id：同一 cwd 下的不同 agent 线程各自一个 PTY。
///
/// `scope` 为空（老前端 / 用户手开的 tab）时退化成 `agent:<cwd>`，
/// 保证升级后旧会话仍能被 attach 上（计划「风险与待确认」的兼容项）。
fn agent_session_id_scoped(cwd: &str, scope: Option<&str>) -> String {
    match scope.map(str::trim).filter(|value| !value.is_empty()) {
        Some(scope) => format!("{AGENT_ID_PREFIX}{cwd}{SCOPE_SEP}{scope}"),
        None => agent_session_id(cwd),
    }
}

#[cfg(test)]
mod session_tests {
    use super::*;

    #[test]
    fn terminal_run_isolated_across_threads() {
        let cwd = "D:\\work\\app";
        let a = agent_session_id_scoped(cwd, Some("thread-a"));
        let b = agent_session_id_scoped(cwd, Some("thread-b"));
        assert_ne!(a, b, "同 cwd 不同线程必须落到不同会话");
        assert_eq!(a, format!("agent:{cwd}#thread-a"));
        // 没有 scope 时退化回旧格式，保证升级后旧 tab 仍可 attach
        assert_eq!(agent_session_id_scoped(cwd, None), format!("agent:{cwd}"));
        assert_eq!(
            agent_session_id_scoped(cwd, Some("   ")),
            format!("agent:{cwd}")
        );
    }
}

/// 由 cwd 解析出 agent 会话 id（`app_terminal_read` 省略 id 时用）。
/// 先 canonicalize 再派生，保证与 `terminal:run` 建的会话是同一个键。
pub fn resolve_agent_session(cwd: &str) -> Result<String, String> {
    resolve_agent_session_scoped(cwd, None)
}

/// 作用域版：`scope` = 线程 id。`terminal:run` 与 `app_terminal_read` 必须同口径，
/// 否则 agent 读到的会是另一个线程的会话。
pub fn resolve_agent_session_scoped(cwd: &str, scope: Option<&str>) -> Result<String, String> {
    let path = validate_cwd(cwd)?;
    Ok(agent_session_id_scoped(&path.display().to_string(), scope))
}

/// 前端跳转用：把任意 workdir 规范成与 Hub 一致的 `agent:<canonical>` id。
#[tauri::command(rename = "terminal:resolve_agent_id")]
pub fn terminal_resolve_agent_id(
    cwd: String,
    scope: Option<String>,
) -> Result<String, String> {
    resolve_agent_session_scoped(&cwd, scope.as_deref())
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

/// 打开一个 PTY 会话：返回会话本体 + 读端（读端交给读线程独占）。
/// `cache_dir` 非空时把 `COGITO_AGENT_CACHE` / `TMP` / `TEMP` 都指向它 —— 于是
/// `mktemp`、`$env:TEMP\x.log`、Node 的 `os.tmpdir()` 全部落到会话缓存目录，
/// 不再散落在仓库根与系统 TEMP（契约见 `utils::agent_cache`）。
fn spawn_session(
    cwd_path: &Path,
    cache_dir: Option<&Path>,
) -> Result<(TerminalSession, Box<dyn Read + Send>), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| format!("打开 PTY 失败：{err}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    cmd.cwd(cwd_path);
    if let Some(dir) = cache_dir {
        let text = dir.display().to_string();
        // 三个变量一起指过去：PowerShell 用 $env:TEMP，mktemp 用 TMP，Node 用 os.tmpdir()
        cmd.env("COGITO_AGENT_CACHE", &text);
        cmd.env("TMP", &text);
        cmd.env("TEMP", &text);
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|err| format!("启动 shell 失败：{err}"))?;

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
        shared: Arc::new(Mutex::new(Scrollback::new())),
    };
    Ok((session, reader))
}

/// 会话不存在就建一个；已存在直接复用（视图与 agent 共用同一个 shell）。
fn ensure_session(
    hub: &TerminalHub,
    app: &AppHandle,
    id: &str,
    cwd_path: &Path,
) -> Result<Option<u32>, String> {
    let mut sessions = hub
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    if let Some(session) = sessions.get(id) {
        return Ok(session.child.process_id());
    }

    // 会话缓存目录：建不出目录就不注入，不能因为缓存把终端拖挂
    let cache_dir = crate::utils::agent_cache::session_dir_or_none(id);
    let (session, reader) = spawn_session(cwd_path, cache_dir.as_deref())?;
    let pid = session.child.process_id();
    let shared = session.shared.clone();
    sessions.insert(id.to_string(), session);
    drop(sessions);

    spawn_reader(hub.sessions.clone(), app.clone(), id.to_string(), shared, reader);
    Ok(pid)
}

/// 把一段原始输出写进回滚缓冲并扇出给所有订阅者；发不出去的订阅者直接摘除。
///
/// 扇出在释放锁之后做：持锁 `channel.send` 会卡住读线程，拖死整条输出管道。
fn push_output(shared: &Arc<Mutex<Scrollback>>, chunk: &[u8]) {
    let mut subscribers = {
        let Ok(mut guard) = shared.lock() else {
            return;
        };
        guard.buffer.extend_from_slice(chunk);
        if guard.buffer.len() > SCROLLBACK_MAX_BYTES {
            let overflow = guard.buffer.len() - SCROLLBACK_MAX_BYTES;
            guard.buffer.drain(..overflow);
            guard.dropped += overflow as u64;
        }
        guard.last_output = Instant::now();
        std::mem::take(&mut guard.subscribers)
    };
    if subscribers.is_empty() {
        return;
    }
    let payload = chunk.to_vec();
    subscribers.retain(|channel| {
        channel
            .send(InvokeResponseBody::Raw(payload.clone()))
            .is_ok()
    });
    let Ok(mut guard) = shared.lock() else {
        return;
    };
    // 扇出期间 attach 进来的新订阅者已在 guard 里；把仍存活的旧订阅接回去
    guard.subscribers.append(&mut subscribers);
}

/// 取会话共享区（不长期持有会话表锁）。
fn find_shared(hub: &TerminalHub, id: &str) -> Result<Arc<Mutex<Scrollback>>, String> {
    let sessions = hub
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    sessions
        .get(id)
        .map(|session| session.shared.clone())
        .ok_or_else(|| format!("终端会话不存在：{id}"))
}

/// 视图接管一个已有会话：登记实时订阅，并把当前回滚缓冲交给调用方经 IPC 回放。
///
/// 克隆缓冲与 `push(subscriber)` 在同一把锁里完成 —— 否则旧字节回放与新字节推送会交错。
/// 回放**不**走 `Channel::send(Raw)`：在 invoke 尚未返回时同步推大块 Raw，WebView2 上经常
/// `Ok` 但前端收不到，只剩光标；改为随 `TerminalCreated.replay` 返回，由前端 `write`。
fn attach_channel(
    hub: &TerminalHub,
    id: &str,
    channel: Channel<InvokeResponseBody>,
) -> Result<(Option<u32>, Vec<u8>), String> {
    let (shared, pid) = {
        let sessions = hub
            .sessions
            .lock()
            .map_err(|_| "终端会话表加锁失败".to_string())?;
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("终端会话不存在：{id}"))?;
        (session.shared.clone(), session.child.process_id())
    };

    let mut guard = shared
        .lock()
        .map_err(|_| "终端输出缓冲加锁失败".to_string())?;
    let replay = guard.buffer.clone();
    guard.subscribers.push(channel);
    Ok((pid, replay))
}

/// 向 PTY 写原始字节（不追加、不改写任何东西）。
fn write_raw(hub: &TerminalHub, id: &str, data: &[u8]) -> Result<(), String> {
    let mut sessions = hub
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| format!("终端会话不存在：{id}"))?;
    session
        .writer
        .write_all(data)
        .map_err(|err| format!("写入终端失败：{err}"))?;
    session
        .writer
        .flush()
        .map_err(|err| format!("刷新终端失败：{err}"))
}

/// 去掉空白后比对：shell 的回显可能被折行/提示符重绘插进换行，逐字节比不可靠。
fn squeeze(text: &str) -> String {
    text.chars().filter(|ch| !ch.is_whitespace()).collect()
}

/// 回显里是否完整出现了命令的首尾特征串；任一缺失即说明这次写入被吞了字符。
fn echo_confirmed(echo: &str, command: &str) -> bool {
    let echoed = squeeze(echo);
    let wanted = squeeze(command);
    if wanted.is_empty() {
        return true;
    }
    let total = wanted.chars().count();
    let probe_len = 24.min(total);
    let head: String = wanted.chars().take(probe_len).collect();
    if !echoed.contains(&head) {
        return false;
    }
    let tail: String = wanted.chars().skip(total - probe_len).collect();
    echoed.contains(&tail)
}

/// 写入前的就绪等待：新会话等第一帧提示符，老会话等它安静下来（最多
/// `READY_TIMEOUT_MS`；等不到也不报错，交给回显核对兜底）。
async fn wait_until_ready(hub: &TerminalHub, id: &str) -> Result<(), String> {
    let started = Instant::now();
    let budget = Duration::from_millis(READY_TIMEOUT_MS);
    loop {
        let (cursor, last_output) = progress(hub, id)?;
        let idle = last_output.elapsed() >= Duration::from_millis(READY_IDLE_MS);
        if cursor > 0 && idle {
            return Ok(());
        }
        if started.elapsed() >= budget {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(READY_POLL_MS)).await;
    }
}

/// 终止并移除一个会话（幂等）。
fn kill_session(hub: &TerminalHub, id: &str) {
    kill_session_in(&hub.sessions, id);
}

/// 与 `kill_session` 同一套动作，但只依赖会话表 —— 闲置回收线程拿不到 `State`。
fn kill_session_in(sessions: &Arc<Mutex<HashMap<String, TerminalSession>>>, id: &str) {
    let removed = sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(id));
    let Some(mut session) = removed else {
        return;
    };
    #[cfg(windows)]
    if let Some(pid) = session.child.process_id() {
        terminate_process_tree(pid);
    }
    let _ = session.child.kill();
    // 会话结束即清掉这次会话的缓存目录；进程刚被杀删不掉的，留给启动时的 prune
    let _ = crate::utils::agent_cache::clear_session(id);
    // 会话没了，闸门与忙碌计数也没有意义（长跑应用里不攒空锁）
    guard::forget_session(id);
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
    let id = id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // 同 id 已存在：只 attach，禁止 silent kill（否则 HMR / 误 create 会杀掉 agent 长跑）
    {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话表加锁失败".to_string())?;
        if sessions.contains_key(&id) {
            drop(sessions);
            let (pid, replay) = attach_channel(state.inner(), &id, channel)?;
            return Ok(TerminalCreated { id, pid, replay });
        }
    }

    let pid = ensure_session(state.inner(), &app, &id, &cwd_path)?;
    let (_attached_pid, replay) = attach_channel(state.inner(), &id, channel)?;
    Ok(TerminalCreated { id, pid, replay })
}

/// 视图接上一个已存在的会话（agent 先建、面板后挂）。
#[tauri::command(rename = "terminal:attach")]
pub fn terminal_attach(
    state: State<'_, TerminalHub>,
    id: String,
    channel: Channel<InvokeResponseBody>,
) -> Result<TerminalCreated, String> {
    // 面板刚挂上来：顺手喊一次缓存的节流清理（30 秒窗口，实际清理在后台线程）。
    // 应用常驻不重启，光靠启动那一轮清不干净；用户也未必会打开设置 → 诊断。
    crate::utils::agent_cache::prune_in_background(false);
    let (pid, replay) = attach_channel(state.inner(), &id, channel)?;
    Ok(TerminalCreated { id, pid, replay })
}

/// 读线程：阻塞读 master → 写回滚缓冲 + 扇出订阅者；EOF 后回收会话并广播退出事件。
fn spawn_reader(
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
    app: AppHandle,
    id: String,
    shared: Arc<Mutex<Scrollback>>,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => push_output(&shared, &buf[..n]),
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

/// 向已有 PTY 会话写入原始字节（桥 `app_terminal_write` 与 IPC `terminal:write` 共用）
pub fn write_session(hub: &TerminalHub, id: &str, data: &[u8]) -> Result<(), String> {
    let mut sessions = hub
        .sessions
        .lock()
        .map_err(|_| "终端会话表加锁失败".to_string())?;
    let session = sessions
        .get_mut(id)
        .ok_or_else(|| "终端会话不存在".to_string())?;
    session
        .writer
        .write_all(data)
        .map_err(|err| format!("写入终端失败：{err}"))?;
    session
        .writer
        .flush()
        .map_err(|err| format!("刷新终端失败：{err}"))
}

#[tauri::command(rename = "terminal:write")]
pub fn terminal_write(
    id: String,
    data: Vec<u8>,
    state: State<'_, TerminalHub>,
) -> Result<(), String> {
    write_session(state.inner(), &id, &data)
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

/// agent 在嵌入式终端里执行一条命令，并把这段时间的输出读回来。
///
/// 结束判定用「安静期」而不是注入标记：不依赖具体 shell（pwsh / bash / 带 Oh My Posh
/// 的提示符各不相同），代价是持续输出的命令（`npm run dev`）会等到超时，此时返回
/// `isRunning: true` + 部分输出，agent 可继续用 `app_terminal_read` 续读。
#[tauri::command(rename = "terminal:run")]
pub async fn terminal_run(
    app: AppHandle,
    state: State<'_, TerminalHub>,
    command: String,
    cwd: Option<String>,
    id: Option<String>,
    scope: Option<String>,
    quiet_ms: Option<u64>,
    timeout_ms: Option<u64>,
) -> Result<TerminalRun, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("命令不能为空".into());
    }
    // 一次写入一行：内嵌换行会被 shell 当成多条命令，结束判定也就失准了
    if trimmed.contains('\n') || trimmed.contains('\r') {
        return Err("命令只能是单行；多条请用 && / ; 串联".into());
    }

    let (session_id, cwd_text) = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|_| "终端会话表加锁失败".to_string())?;
        match (id.filter(|value| !value.trim().is_empty()), cwd) {
            (Some(id), _) => {
                let session = sessions
                    .get(&id)
                    .ok_or_else(|| format!("终端会话不存在：{id}"))?;
                (id, session.cwd.clone())
            }
            (None, Some(cwd)) => {
                let path = validate_cwd(&cwd)?;
                let text = path.display().to_string();
                (agent_session_id_scoped(&text, scope.as_deref()), text)
            }
            (None, None) => return Err("缺少 cwd（或传 id 指向一个已有终端会话）".into()),
        }
    };

    // 同一会话的 `terminal:run` 串行：并发写入会让两条命令行交叉，
    // `read_since(start_cursor)` 也会把别人的输出算进本次结果
    // （计划「终端会话隔离」的 B 方案）。交互式 `terminal:write` 不排队。
    let gate = guard::session_gate(&session_id);
    let _run_gate = gate.lock().await;
    // 从落定会话到本轮结束都算忙：闲置回收据此跳过，不会杀掉正在跑的命令
    let _busy = guard::BusyMark::enter(&session_id);
    ensure_session(state.inner(), &app, &session_id, Path::new(&cwd_text))?;
    // 等 shell 就绪（第一帧提示符 / 上一条命令安静下来），否则命令头几个字符会被吞
    write::probe_ready(state.inner(), &session_id).await?;
    // 先让前端把 tab 打开/切过去：用户看得到 agent 正在跑什么
    let _ = app.emit(
        AGENT_RUN_EVENT,
        TerminalAgentRunEvent {
            id: session_id.clone(),
            cwd: cwd_text,
            command: trimmed.clone(),
        },
    );

    let started = Instant::now();
    let (start_cursor, _) = progress(state.inner(), &session_id)?;
    write_command(state.inner(), &session_id, &trimmed).await?;

    let quiet = Duration::from_millis(quiet_ms.unwrap_or(DEFAULT_QUIET_MS).clamp(50, 10_000));
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(500, 600_000));
    let mut is_running = true;
    loop {
        tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;
        // 会话已退出（命令把 shell 结束了）也当结束处理，把已有输出交回去
        let Ok((cursor, last_output)) = progress(state.inner(), &session_id) else {
            is_running = false;
            break;
        };
        if cursor > start_cursor && last_output.elapsed() >= quiet {
            is_running = false;
            break;
        }
        if started.elapsed() >= timeout {
            break;
        }
    }

    let output = read_since(state.inner(), &session_id, start_cursor)?;
    Ok(TerminalRun {
        id: session_id,
        command: trimmed,
        output,
        is_running,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

/// 读会话最近的输出（`terminal:run` 超时后的续读入口）。
#[tauri::command(rename = "terminal:read")]
pub fn terminal_read(
    state: State<'_, TerminalHub>,
    id: String,
    max_chars: Option<usize>,
) -> Result<TerminalRead, String> {
    let limit = max_chars.unwrap_or(RUN_OUTPUT_MAX_CHARS).clamp(200, SCROLLBACK_MAX_BYTES);
    let shared = find_shared(state.inner(), &id)?;
    let guard = shared
        .lock()
        .map_err(|_| "终端输出缓冲加锁失败".to_string())?;
    Ok(TerminalRead {
        id,
        output: tail_chars(&strip_ansi(&guard.buffer), limit),
    })
}

/// 游标 + 最近一次写入时间
fn progress(hub: &TerminalHub, id: &str) -> Result<(u64, Instant), String> {
    let shared = find_shared(hub, id)?;
    let guard = shared
        .lock()
        .map_err(|_| "终端输出缓冲加锁失败".to_string())?;
    Ok((guard.cursor(), guard.last_output))
}

/// 取 `cursor` 之后的输出（环形缓冲已丢弃的部分无法找回，只能从现有最早处开始）
fn read_since(hub: &TerminalHub, id: &str, cursor: u64) -> Result<String, String> {
    let shared = find_shared(hub, id)?;
    let guard = shared
        .lock()
        .map_err(|_| "终端输出缓冲加锁失败".to_string())?;
    let offset = usize::try_from(cursor.saturating_sub(guard.dropped)).unwrap_or(0);
    let start = offset.min(guard.buffer.len());
    Ok(tail_chars(
        &strip_ansi(&guard.buffer[start..]),
        RUN_OUTPUT_MAX_CHARS,
    ))
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

/// 闲置关闭时推给前端的载荷（前端据此写系统行 + 移除 tab）。
#[derive(Clone, Serialize)]
struct TerminalIdleEvent {
    id: String,
    cwd: String,
    text: String,
}

/// 系统行文案（与前端写入 xterm 的内容保持一致）。
pub const IDLE_CLOSED_TEXT: &str = "会话已结束（闲置）";

/// 闲置回收的唯一判据：只碰 agent 会话（用户手开的 tab 不替他关）、没有 run 在跑、
/// 且静默超过 TTL。抽成纯函数是为了能单测 —— 回收器跑在裸线程里，没法断言。
fn should_reap(id: &str, idle: Duration, busy: bool, ttl: Duration) -> bool {
    id.starts_with(AGENT_ID_PREFIX) && !busy && idle >= ttl
}

/// 起一个只回收 agent 会话的线程：`IDLE_TTL` 内无输出且没有在跑的 run 就 kill。
///
/// - 用户手开的 tab（uuid id）不受影响 —— 那是他自己开的，不该替他关；
/// - 有 run 在跑（`guard::is_busy`）的跳过，长命令不会被误杀；
/// - `COGITO_TERMINAL_IDLE_CLOSE=0` 可整体停用（排查用）。
pub fn start_idle_reaper(app: AppHandle) {
    let sessions = {
        let hub = app.state::<TerminalHub>();
        Arc::clone(&hub.sessions)
    };
    std::thread::spawn(move || loop {
        std::thread::sleep(REAPER_TICK);
        if std::env::var("COGITO_TERMINAL_IDLE_CLOSE").as_deref() == Ok("0") {
            continue;
        }
        let mut victims: Vec<(String, String, Arc<Mutex<Scrollback>>)> = Vec::new();
        if let Ok(sessions) = sessions.lock() {
            for (id, session) in sessions.iter() {
                if !id.starts_with(AGENT_ID_PREFIX) {
                    continue;
                }
                let busy = guard::is_busy(id);
                let idle = session
                    .shared
                    .lock()
                    .map(|shared| shared.last_output.elapsed())
                    .unwrap_or_default();
                if should_reap(id, idle, busy, guard::IDLE_TTL) {
                    victims.push((id.clone(), session.cwd.clone(), Arc::clone(&session.shared)));
                }
            }
        }
        for (id, cwd, shared) in victims {
            // 先往 scrollback 写一行系统提示：仍 attached 的 xterm 会实时收到，
            // 用户看到的是「会话已结束（闲置）」而不是终端凭空消失。
            let notice = format!("\r\n\x1b[33m{IDLE_CLOSED_TEXT}\x1b[0m\r\n");
            push_output(&shared, notice.as_bytes());
            let _ = app.emit(
                IDLE_CLOSED_EVENT,
                TerminalIdleEvent {
                    id: id.clone(),
                    cwd,
                    text: IDLE_CLOSED_TEXT.to_string(),
                },
            );
            kill_session_in(&sessions, &id);
            tracing::info!(target: "terminal", "闲置回收：{id}");
        }
    });
}

#[tauri::command(rename = "terminal:kill")]
pub fn terminal_kill(id: String, state: State<'_, TerminalHub>) -> Result<(), String> {
    // 幂等：视图卸载与读线程 EOF 可能先后 kill
    kill_session(state.inner(), &id);
    Ok(())
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
