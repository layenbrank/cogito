//! 崩溃可观测性：panic hook、会话标记、崩溃现场落盘。
//!
//! 目标：即使 release 是 `windows_subsystem = "windows"`、日志插件没起来、
//! 甚至进程被 abort / 强杀，也要在磁盘上留下可读现场，供下次启动补报。
//!
//! 目录布局（`<appLocalData>/` = `%LOCALAPPDATA%\com.cogito.client`）：
//!
//! ```text
//! diagnostics/session.json       running → clean（区分正常退出 / 异常退出）
//! diagnostics/crash/<id>.json    每次 panic 一份现场（前端读走 → 上报 → ack 删除）
//! diagnostics/cogito-crash.log   panic 的纯文本副本（不依赖日志插件是否可用）
//! ```
//!
//! 这里刻意**不依赖** `AppHandle`：panic hook 要在 Tauri 起来之前安装，
//! 所以路径按 `identifier` 自行推导（与 `main.rs` 的 `APP_IDENTIFIER` 同值）。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Once;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// 与 `tauri.conf.json` 的 `identifier` 一致。
pub const APP_IDENTIFIER: &str = "com.cogito.client";

const DIAG_DIR: &str = "diagnostics";
const CRASH_DIR: &str = "crash";
const SESSION_FILE: &str = "session.json";
const CRASH_LOG_FILE: &str = "cogito-crash.log";

/// 崩溃目录里最多保留多少份现场（超出丢最旧的）。
const MAX_CRASH_FILES: usize = 50;
/// 上报接口的 `message` 上限是 2000 字节，落盘前先截断，免得整条被拒。
const MAX_MESSAGE_CHARS: usize = 2000;
/// backtrace 也有上限（服务端 `stack` ≤ 20000），留点余量给前缀。
const MAX_BACKTRACE_CHARS: usize = 16_000;

/// 一次 panic 的现场。字段与前端 `PendingCrash` 一一对应（camelCase）。
///
/// `caught` 区分两种 panic：
/// - `false`：没人兜住 —— 进程正在 unwind（`panic = "abort"` 时直接消失），
///   属于**应用崩溃**，补报时按 `fatal` 上报；
/// - `true`：发生在 `catch_unwind` 保护范围内（向量库对第三方 panic 的兜底），
///   只是「这一次操作失败」，补报时降级为 `error`，也不该污染崩溃率统计。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CrashRecord {
    /// 现场文件名（不含扩展名）；前端 ack 时回传它删文件。
    pub id: String,
    /// 上报幂等键（UUID v4）：同一份现场被重复上报时服务端会拒。
    pub event_id: String,
    /// panic 发生的毫秒时间戳。
    pub timestamp: i64,
    /// 线程名（`<unnamed>` 兜底）。
    pub thread: String,
    /// panic 摘要（已截断到 2000 字符）。
    pub message: String,
    /// `file:line:column`。
    pub location: Option<String>,
    /// 调用栈文本（可能只有地址，release 里 `strip = true`）。
    pub backtrace: String,
    /// 应用版本（`CARGO_PKG_VERSION`）。
    pub app_version: String,
    /// `os/arch` 摘要。
    pub os: String,
    /// panic 是否发生在 `catch_unwind` 保护范围内（见 [`panic_is_caught`]）。
    pub caught: bool,
}

/// 会话标记：正常退出写 `clean`，否则下次启动看到 `running` 即「上次异常退出」。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub state: String,
    pub pid: u32,
    pub started_at: i64,
    pub ended_at: Option<i64>,
}

/// 应用本地数据目录（`%LOCALAPPDATA%\com.cogito.client`）。
///
/// `dirs::data_local_dir()` 在 Windows 就是 `%LOCALAPPDATA%`，与
/// `AppHandle::path().app_local_data_dir()` 同源；Linux 是 `$XDG_DATA_HOME`，
/// macOS 是 `~/Library/Application Support`（Tauri 亦如此）。
pub fn app_data_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join(APP_IDENTIFIER))
}

/// `<appLocalData>/diagnostics`
pub fn diagnostics_dir() -> Option<PathBuf> {
    app_data_dir().map(|base| base.join(DIAG_DIR))
}

/// `<appLocalData>/diagnostics/crash`
pub fn crash_dir() -> Option<PathBuf> {
    diagnostics_dir().map(|dir| dir.join(CRASH_DIR))
}

/// 当前毫秒时间戳。
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)
}

/// 截断到 `max` 个字符（按 `char` 而非字节，避免切坏 UTF-8）。
fn truncate_chars(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let mut out: String = input.chars().take(max).collect();
    out.push('…');
    out
}

thread_local! {
    /// 本线程正在执行的「panic 会被 `catch_unwind` 兜住」的嵌套层数。
    static CAUGHT_PANIC_DEPTH: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
}

/// 标记一段代码里的 panic 会被上游 `catch_unwind` 兜住。
///
/// panic hook 在展开**开始之前**读这个标记：> 0 说明这次 panic 只是「内部故障」，
/// 落盘时写 `caught: true`，补报时降级为 `error`，不计入应用崩溃。
///
/// 跨 `.await` 的异步代码别直接用它 —— 任务可能在等待期间被搬到别的线程，
/// 标记跟着线程走了、代码没走。异步场景用 [`caught_scope`]。
pub struct CaughtPanicGuard(());

impl CaughtPanicGuard {
    pub fn new() -> Self {
        CAUGHT_PANIC_DEPTH.with(|depth| depth.set(depth.get().saturating_add(1)));
        Self(())
    }
}

impl Default for CaughtPanicGuard {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for CaughtPanicGuard {
    fn drop(&mut self) {
        CAUGHT_PANIC_DEPTH.with(|depth| depth.set(depth.get().saturating_sub(1)));
    }
}

/// 当前线程此刻是否处于 `catch_unwind` 保护范围内。
pub fn panic_is_caught() -> bool {
    CAUGHT_PANIC_DEPTH.with(|depth| depth.get() > 0)
}

/// 把一个 future 包成「**poll 期间**算作被兜住」。
///
/// 标记收在 `poll` 里而不是构造处：tokio 可以在 `.await` 之间把任务搬到别的
/// worker 线程上，只有「正在 poll 的那个线程」才是 panic 真正发生的地方。
pub struct CaughtPanicScope<F>(F);

/// 见 [`CaughtPanicScope`]。
pub fn caught_scope<F>(future: F) -> CaughtPanicScope<F> {
    CaughtPanicScope(future)
}

impl<F: std::future::Future> std::future::Future for CaughtPanicScope<F> {
    type Output = F::Output;

    fn poll(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Self::Output> {
        let _guard = CaughtPanicGuard::new();
        // SAFETY: 只把内部 future 原样 poll，不移动它，也不碰别的字段。
        let inner = unsafe { self.map_unchecked_mut(|scope| &mut scope.0) };
        inner.poll(cx)
    }
}

/// 装 panic hook：先落盘（不依赖日志插件），再尽力写一条 `log::error!`。
///
/// 顺序很关键：如果 panic 恰好发生在持日志锁的线程上，`log::error!` 可能自锁，
/// 所以现场文件必须先写出去 —— 宁可少一行日志，不能丢整个现场。
pub fn install_panic_hook() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let record = build_record(info);
            if let Err(error) = persist_record(&record) {
                // 落盘都失败就只能退回默认 hook（至少 stderr 有）
                let _ = writeln!(std::io::stderr(), "panic 现场落盘失败: {error}");
            }
            log::error!(
                target: "panic",
                "panic: {} at {} (thread={})",
                record.message,
                record.location.as_deref().unwrap_or("<unknown>"),
                record.thread
            );
            default_hook(info);
        }));
    });
}

/// 开发期崩溃演练（**仅 debug 构建**）：`COGITO_DEV_PANIC` 非空时启动后制造一次真实故障。
///
/// - `abort` → `std::process::abort()`：不走 `RunEvent::Exit`，用来验证 sidecar 回收
///   与「下次启动识别异常退出」都不依赖优雅退出；
/// - 其它值 → 1.5s 后在独立线程 `panic!("boom: <值>")`：验证 panic hook 落盘 + 日志。
///
/// 用途是让「崩溃 → 现场 → 下次启动补报」这条链路可以在真实二进制上跑一遍，
/// release 构建里不存在这个入口，不构成额外攻击面。
#[cfg(debug_assertions)]
pub fn spawn_dev_panic_probe() {
    let Some(raw) = std::env::var_os("COGITO_DEV_PANIC") else {
        return;
    };
    let mode = raw.to_string_lossy().trim().to_string();
    if mode.is_empty() || mode == "0" {
        return;
    }
    // 延迟可调：验「abort 之后 sidecar 会不会变孤儿」需要等 sidecar 起完再崩
    let delay_ms = std::env::var("COGITO_DEV_PANIC_DELAY_MS")
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .unwrap_or(1_500);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        if mode.eq_ignore_ascii_case("abort") {
            log::error!(target: "diagnostics", "演练：std::process::abort()（跳过 RunEvent::Exit）");
            std::process::abort();
        }
        panic!("boom: {mode}");
    });
}

/// 从 `PanicHookInfo` 组装现场（不落盘，便于单测）。
fn build_record_from_parts(
    message: &str,
    location: Option<String>,
    thread: &str,
    backtrace: &str,
    timestamp: i64,
    caught: bool,
) -> CrashRecord {
    let event_id = uuid::Uuid::new_v4().to_string();
    let id = format!("{timestamp}-{}", &event_id[..8]);
    CrashRecord {
        id,
        event_id,
        timestamp,
        thread: thread.to_string(),
        message: truncate_chars(message, MAX_MESSAGE_CHARS),
        location,
        backtrace: truncate_chars(backtrace, MAX_BACKTRACE_CHARS),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os: format!("{}/{}", std::env::consts::OS, std::env::consts::ARCH),
        caught,
    }
}

fn build_record(info: &std::panic::PanicHookInfo<'_>) -> CrashRecord {
    let payload = info.payload();
    let message = if let Some(text) = payload.downcast_ref::<&str>() {
        (*text).to_string()
    } else if let Some(text) = payload.downcast_ref::<String>() {
        text.clone()
    } else {
        "非字符串 panic payload".to_string()
    };
    let location = info
        .location()
        .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()));
    let thread = std::thread::current()
        .name()
        .unwrap_or("<unnamed>")
        .to_string();
    let backtrace = std::backtrace::Backtrace::force_capture().to_string();
    // hook 跑在展开开始之前：此刻线程局标记还在，读到的就是「这次 panic 有没有人兜」。
    build_record_from_parts(
        &message,
        location,
        &thread,
        &backtrace,
        now_ms(),
        panic_is_caught(),
    )
}

/// 把现场写到 `dir/<id>.json`，并同步追加一份纯文本日志。
fn persist_record_to(dir: &Path, record: &CrashRecord) -> std::io::Result<PathBuf> {
    ensure_dir(dir)?;
    let file = dir.join(format!("{}.json", record.id));
    let json = serde_json::to_vec_pretty(record)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    fs::write(&file, json)?;

    // 纯文本副本：日志插件没起来 / 被锁住时仍然有痕迹
    let log_path = dir
        .parent()
        .map(|parent| parent.join(CRASH_LOG_FILE))
        .unwrap_or_else(|| dir.join(CRASH_LOG_FILE));
    if let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = writeln!(
            handle,
            "[{}] thread={} loc={} msg={}",
            record.timestamp,
            record.thread,
            record.location.as_deref().unwrap_or("<unknown>"),
            record.message
        );
        let _ = handle.flush();
    }

    Ok(file)
}

fn persist_record(record: &CrashRecord) -> std::io::Result<PathBuf> {
    let dir = crash_dir()
        .ok_or_else(|| std::io::Error::other("无法解析应用数据目录"))?;
    let written = persist_record_to(&dir, record)?;
    prune_crash_dir(&dir, MAX_CRASH_FILES);
    Ok(written)
}

/// 只保留最近 `keep` 份现场（按修改时间）。
fn prune_crash_dir(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .collect();
    if files.len() <= keep {
        return;
    }
    files.sort_by_key(|(modified, _)| *modified);
    let drop_count = files.len() - keep;
    for (_, path) in files.into_iter().take(drop_count) {
        let _ = fs::remove_file(path);
    }
}

/// 开新会话：**先**读出上一次的标记，**再**覆盖成本次 `running`，返回上一次的标记。
///
/// 顺序不能反：先写 `running` 再读，会把上一次的 `running` 当成自己的 pid，
/// `previous_session_crashed` 永远 false —— 崩溃就再也认不出来（曾经就栽在这）。
pub fn begin_session() -> Option<SessionRecord> {
    let dir = diagnostics_dir()?;
    let (previous, _) = begin_session_in(&dir);
    previous
}

fn begin_session_in(dir: &Path) -> (Option<SessionRecord>, SessionRecord) {
    let previous = read_session_from(dir);
    let record = SessionRecord {
        state: "running".to_string(),
        pid: std::process::id(),
        started_at: now_ms(),
        ended_at: None,
    };
    write_session(dir, &record);
    (previous, record)
}

/// 正常退出（`RunEvent::Exit`）时改写为 `clean`。
pub fn mark_clean_exit() {
    let Some(dir) = diagnostics_dir() else {
        return;
    };
    let started_at = read_session_from(&dir)
        .map(|record| record.started_at)
        .unwrap_or_else(now_ms);
    let record = SessionRecord {
        state: "clean".to_string(),
        pid: std::process::id(),
        started_at,
        ended_at: Some(now_ms()),
    };
    write_session(&dir, &record);
}

fn write_session(dir: &Path, record: &SessionRecord) {
    if ensure_dir(dir).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_vec_pretty(record) else {
        return;
    };
    let target = dir.join(SESSION_FILE);
    // 先写临时文件再 rename：避免写到一半被杀留下半截 JSON
    let tmp = dir.join(format!("{SESSION_FILE}.tmp"));
    if fs::write(&tmp, json).is_ok() {
        let _ = fs::rename(&tmp, &target);
    }
}

fn read_session_from(dir: &Path) -> Option<SessionRecord> {
    let raw = fs::read_to_string(dir.join(SESSION_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 读上一次会话标记（`None` = 首次启动或文件损坏）。
pub fn read_session() -> Option<SessionRecord> {
    diagnostics_dir().and_then(|dir| read_session_from(&dir))
}

/// 上次是否异常退出：有会话记录、状态仍是 `running`、且不是当前进程写的。
pub fn previous_session_crashed(session: Option<&SessionRecord>) -> bool {
    match session {
        Some(record) => record.state == "running" && record.pid != std::process::id(),
        None => false,
    }
}

fn read_crashes_from(dir: &Path) -> Vec<CrashRecord> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut records: Vec<CrashRecord> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                return None;
            }
            let raw = fs::read_to_string(&path).ok()?;
            match serde_json::from_str::<CrashRecord>(&raw) {
                Ok(record) => Some(record),
                Err(error) => {
                    log::warn!(target: "diagnostics", "跳过损坏的崩溃现场 {}: {error}", path.display());
                    None
                }
            }
        })
        .collect();
    records.sort_by_key(|record| record.timestamp);
    records
}

/// 待上报的崩溃现场（按时间升序）。
pub fn read_pending_crashes() -> Vec<CrashRecord> {
    crash_dir()
        .map(|dir| read_crashes_from(&dir))
        .unwrap_or_default()
}

fn ack_crash_in(dir: &Path, id: &str) -> bool {
    // id 来自我们自己生成的文件名，仍然只允许安全字符，避免路径穿越
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return false;
    }
    fs::remove_file(dir.join(format!("{id}.json"))).is_ok()
}

/// 删除一份已上报的现场。
pub fn ack_crash(id: &str) -> bool {
    crash_dir()
        .map(|dir| ack_crash_in(&dir, id))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cogito-diag-{tag}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn truncate_keeps_utf8_boundaries() {
        let text = "崩溃现场".repeat(10);
        let cut = truncate_chars(&text, 5);
        assert_eq!(cut.chars().count(), 6, "5 个字符 + 省略号");
        assert!(cut.ends_with('…'));
        assert_eq!(truncate_chars("短", 10), "短");
    }

    #[test]
    fn crash_record_roundtrip_and_ack() {
        let dir = temp_dir("roundtrip");
        let record = build_record_from_parts(
            "boom",
            Some("src/main.rs:1:1".to_string()),
            "main",
            "backtrace-line",
            1_700_000_000_000,
            false,
        );

        let path = persist_record_to(&dir, &record).expect("落盘");
        assert!(path.is_file(), "现场文件必须存在");

        // 纯文本副本也写了
        let log_path = dir.parent().expect("父目录").join(CRASH_LOG_FILE);
        let log = fs::read_to_string(&log_path).expect("崩溃日志");
        assert!(log.contains("boom"), "纯文本副本要含 panic 摘要");

        let pending = read_crashes_from(&dir);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0], record);
        assert!(!record.event_id.is_empty(), "eventID 用于上报幂等");

        assert!(ack_crash_in(&dir, &record.id), "ack 应删掉现场");
        assert!(read_crashes_from(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn caught_guard_nests_and_restores() {
        assert!(!panic_is_caught(), "默认不在保护范围内");
        {
            let _guard = CaughtPanicGuard::new();
            assert!(panic_is_caught());
            {
                let _nested = CaughtPanicGuard::new();
                assert!(panic_is_caught(), "嵌套也算被兜住");
            }
            assert!(panic_is_caught(), "内层离开不该抹掉外层标记");
        }
        assert!(!panic_is_caught(), "guard 全部离开后必须回到未保护状态");
    }

    #[test]
    fn caught_scope_marks_panic_raised_while_polling() {
        use std::sync::atomic::{AtomicBool, Ordering};

        let observed = std::sync::Arc::new(AtomicBool::new(false));
        let flag = observed.clone();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            futures::executor::block_on(caught_scope(async move {
                // 这条就是 panic hook 在真实场景里会读到的值
                flag.store(panic_is_caught(), Ordering::SeqCst);
                panic!("boom: vectorstore");
            }))
        }));
        assert!(outcome.is_err(), "panic 必须被 catch_unwind 兜住");
        assert!(observed.load(Ordering::SeqCst), "poll 期间必须处于保护范围");
        assert!(!panic_is_caught(), "展开结束后标记要清掉");
    }

    #[test]
    fn caught_flag_reaches_the_record() {
        let caught = build_record_from_parts("boom", None, "t", "", 1, true);
        let fatal = build_record_from_parts("boom", None, "t", "", 1, false);
        assert!(caught.caught, "被兜住的 panic 要能传到现场里");
        assert!(!fatal.caught);
    }

    #[test]
    fn ack_rejects_path_traversal() {
        let dir = temp_dir("ack-guard");
        assert!(!ack_crash_in(&dir, "../session"));
        assert!(!ack_crash_in(&dir, ""));
        assert!(!ack_crash_in(&dir, "a/b"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_crash_file_is_skipped() {
        let dir = temp_dir("malformed");
        fs::write(dir.join("broken.json"), "{not json").expect("写坏文件");
        assert!(read_crashes_from(&dir).is_empty(), "坏文件不该让启动失败");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn session_marks_unclean_run() {
        let dir = temp_dir("session");
        let running = SessionRecord {
            state: "running".to_string(),
            pid: 424_242,
            started_at: 1,
            ended_at: None,
        };
        write_session(&dir, &running);
        let read = read_session_from(&dir).expect("读回");
        assert_eq!(read.state, "running");
        assert!(
            previous_session_crashed(Some(&read)),
            "别的 pid 留下 running = 上次异常退出"
        );

        let clean = SessionRecord {
            state: "clean".to_string(),
            pid: 424_242,
            started_at: 1,
            ended_at: Some(2),
        };
        write_session(&dir, &clean);
        assert!(!previous_session_crashed(Some(&clean)));
        assert!(!previous_session_crashed(None), "首次启动不算崩溃");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn begin_session_detects_previous_crash_before_overwriting() {
        let dir = temp_dir("begin-session");
        let foreign = SessionRecord {
            state: "running".to_string(),
            pid: 999_999,
            started_at: 1,
            ended_at: None,
        };
        write_session(&dir, &foreign);

        let (previous, current) = begin_session_in(&dir);
        assert!(
            previous_session_crashed(previous.as_ref()),
            "开新会话必须先看到上一次留下的 running"
        );
        assert_eq!(current.pid, std::process::id());
        assert_eq!(
            read_session_from(&dir).expect("读回").pid,
            std::process::id(),
            "本次 running 必须覆盖旧标记"
        );
        assert!(!previous_session_crashed(Some(&current)), "自己的 pid 不算崩溃");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_keeps_newest_files() {
        let dir = temp_dir("prune");
        for index in 0..5 {
            let record = build_record_from_parts(
                &format!("panic-{index}"),
                None,
                "t",
                "",
                1_700_000_000_000 + index,
                false,
            );
            persist_record_to(&dir, &record).expect("落盘");
        }
        prune_crash_dir(&dir, 2);
        assert_eq!(read_crashes_from(&dir).len(), 2, "只留最近 2 份");
        let _ = fs::remove_dir_all(&dir);
    }
}
