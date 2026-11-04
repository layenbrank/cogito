//! 诊断 IPC 命令。
//!
//! | 命令 | 作用 |
//! | --- | --- |
//! | `diagnostics:append` | 前端日志批量落到 `logs/cogito.log`（经 `log` facade） |
//! | `diagnostics:pending` | 列出待上报的崩溃现场 + 会话状态 + 日志尾巴 |
//! | `diagnostics:ack` | 删除已上报的现场（幂等） |
//! | `diagnostics:capabilities` | 版本 / 档位 / 目录 / 待报数量，供「设置 → 诊断」展示 |

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::utils::diagnostics::{self, CrashRecord, SessionRecord};

/// 单条前端日志上限（字符）：一条巨大的 DOM dump 不该把日志刷爆。
const MAX_LOG_LINE_CHARS: usize = 4_000;
/// 一次 `append` 最多接受的条数（前端已按 20 条/秒限流，这里再兜一层）。
const MAX_LOG_BATCH: usize = 200;
/// 崩溃上报附带的日志尾巴上限（`context` 是 JSON，控制体积）。
const MAX_LOG_TAIL_BYTES: u64 = 8 * 1024;

/// 一条前端日志。字段全部来自 `log-bridge.ts`，缺省值都容忍。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendLogEntry {
    /// `error` / `warn` / `info` / `debug` / `trace`
    pub level: String,
    pub message: String,
    /// 逻辑来源（`console` / `window.onerror` / `unhandledrejection` …）
    #[serde(default)]
    pub target: Option<String>,
    /// 当前 window label（`main` / `overlay` / `capture` …）
    #[serde(default)]
    pub window: Option<String>,
    /// 前端事件的时间戳（epoch ms）；只做参考，落盘时间以 Rust 侧为准。
    #[serde(default)]
    pub timestamp: Option<i64>,
}

/// `diagnostics:pending` 的返回。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDiagnostics {
    /// 待上报的崩溃现场（按时间升序）。
    pub crashes: Vec<CrashRecord>,
    /// 上一次会话标记；`None` = 首次启动 / 文件损坏。
    pub session: Option<SessionRecord>,
    /// 上次是否异常退出（`running` 且 pid 不是当前进程）。
    pub previous_session_crashed: bool,
    /// 最近一份日志的尾巴（≤8KB），作为上报的 `context.logTail`。
    pub log_tail: Option<String>,
}

/// `diagnostics:capabilities` 的返回：给「设置 → 诊断」用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsCapabilities {
    pub app_version: String,
    pub identifier: String,
    /// `slim` / `full`（`CLIENT_SIDECAR_VARIANT`，默认 `slim`）
    pub variant: String,
    pub platform: String,
    pub arch: String,
    pub app_data_dir: Option<String>,
    pub log_dir: Option<String>,
    pub diagnostics_dir: Option<String>,
    pub crash_dir: Option<String>,
    /// 当前待上报现场数量。
    pub pending_crash_count: usize,
    pub session_state: Option<String>,
    /// 单个日志文件上限（字节），与 `utils::log_retention` 一致。
    pub log_max_file_size: u64,
}

/// 打包档位：构建期 `CLIENT_SIDECAR_VARIANT` 优先，其次运行期环境变量，默认 `slim`。
fn normalize_variant(raw: Option<&str>) -> String {
    match raw.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
        Some("full") => "full".to_string(),
        _ => "slim".to_string(),
    }
}

/// 打包档位：**只认编译期** `CLIENT_SIDECAR_VARIANT`（由构建脚本注入）。
///
/// 档位是产物属性：运行时环境变量若能改写它，slim 包就能自称 full，
/// 诊断页与「缺件提示」会跟着说错话。
pub fn sidecar_variant() -> String {
    normalize_variant(option_env!("CLIENT_SIDECAR_VARIANT"))
}

/// `<appLocalData>/logs`（与 `tauri-plugin-log` 的 `Target::LogDir` 同目录）。
pub fn log_dir() -> Option<PathBuf> {
    diagnostics::app_data_dir().map(|base| base.join("logs"))
}

/// 截断到 `max` 个字符（按 `char`，不切坏 UTF-8）。
fn truncate_chars(input: &str, max: usize) -> String {
    if input.chars().count() <= max {
        return input.to_string();
    }
    let mut out: String = input.chars().take(max).collect();
    out.push('…');
    out
}

fn parse_level(raw: &str) -> log::Level {
    match raw.trim().to_ascii_lowercase().as_str() {
        "error" | "fatal" | "panic" => log::Level::Error,
        "warn" | "warning" => log::Level::Warn,
        "debug" => log::Level::Debug,
        "trace" => log::Level::Trace,
        _ => log::Level::Info,
    }
}

/// 把一批前端日志交给 `log` facade。
///
/// 返回实际写入的条数；级别非法按 `info` 处理，超长单条截断，整批超限只取前
/// `MAX_LOG_BATCH` 条 —— 宁可少记，也不要因为一条坏数据把 IPC 拖死。
#[tauri::command(rename = "diagnostics:append")]
pub fn diagnostics_append(entries: Vec<FrontendLogEntry>) -> usize {
    let mut written = 0usize;
    for entry in entries.into_iter().take(MAX_LOG_BATCH) {
        let level = parse_level(&entry.level);
        let message = truncate_chars(&entry.message, MAX_LOG_LINE_CHARS);
        let target = entry.target.as_deref().unwrap_or("webview");
        let window = entry.window.as_deref().unwrap_or("-");
        let stamp = entry.timestamp.unwrap_or(0);
        log::log!(
            target: "webview",
            level,
            "[{target}] [{window}] (t={stamp}) {message}"
        );
        written += 1;
    }
    written
}

/// 待上报的崩溃现场 + 会话状态 + 日志尾巴。
#[tauri::command(rename = "diagnostics:pending")]
pub fn diagnostics_pending() -> PendingDiagnostics {
    let session = diagnostics::read_session();
    let previous_session_crashed = diagnostics::previous_session_crashed(session.as_ref());
    PendingDiagnostics {
        crashes: diagnostics::read_pending_crashes(),
        session,
        previous_session_crashed,
        log_tail: log_dir().and_then(|dir| read_log_tail(&dir, MAX_LOG_TAIL_BYTES)),
    }
}

/// 删除一份已上报的现场；`false` = 文件不存在 / id 非法。
#[tauri::command(rename = "diagnostics:ack")]
pub fn diagnostics_ack(id: String) -> bool {
    let removed = diagnostics::ack_crash(&id);
    if removed {
        log::debug!(target: "diagnostics", "崩溃现场已确认（{id}）");
    }
    removed
}

/// 目录种类 → 绝对路径；未知种类报错。
fn dir_for_kind(kind: &str) -> Result<Option<PathBuf>, String> {
    match kind {
        "log" => Ok(log_dir()),
        "crash" => Ok(diagnostics::crash_dir()),
        "data" => Ok(diagnostics::app_data_dir()),
        other => Err(format!("未知的诊断目录类型：{other}")),
    }
}

/// 用系统文件管理器打开诊断目录，返回实际打开的路径。
///
/// 目录可能还没被创建（首次启动 / 还没崩溃过），这里先补齐再打开 ——
/// 否则用户点「打开目录」只会看到资源管理器的报错弹窗。
#[tauri::command(rename = "diagnostics:open-dir")]
pub fn diagnostics_open_dir(kind: String) -> Result<String, String> {
    let target = dir_for_kind(&kind)?
        .ok_or_else(|| "取不到应用数据目录".to_string())?;
    fs::create_dir_all(&target).map_err(|error| format!("创建目录失败：{error}"))?;
    let path = target.display().to_string();
    tauri_plugin_opener::open_path(path.clone(), None::<String>)
        .map_err(|error| format!("打开目录失败：{error}"))?;
    log::debug!(target: "diagnostics", "打开诊断目录：{path}");
    Ok(path)
}

/// 能力自述：版本、档位、目录、待报数量。
#[tauri::command(rename = "diagnostics:capabilities")]
pub fn diagnostics_capabilities() -> DiagnosticsCapabilities {
    DiagnosticsCapabilities {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        identifier: diagnostics::APP_IDENTIFIER.to_string(),
        variant: sidecar_variant(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        app_data_dir: diagnostics::app_data_dir().map(|dir| dir.display().to_string()),
        log_dir: log_dir().map(|dir| dir.display().to_string()),
        diagnostics_dir: diagnostics::diagnostics_dir().map(|dir| dir.display().to_string()),
        crash_dir: diagnostics::crash_dir().map(|dir| dir.display().to_string()),
        pending_crash_count: diagnostics::read_pending_crashes().len(),
        session_state: diagnostics::read_session().map(|record| record.state),
        log_max_file_size: crate::utils::log_retention::LOG_MAX_FILE_SIZE as u64,
    }
}

/// 目录下最新的 `*.log`（按修改时间）。
fn newest_log_file(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("log") {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

/// 读 `dir` 下最新日志的尾部最多 `max_bytes` 字节；丢掉被截断的首行。
fn read_log_tail(dir: &Path, max_bytes: u64) -> Option<String> {
    let path = newest_log_file(dir)?;
    read_tail_from(&path, max_bytes)
}

fn read_tail_from(path: &Path, max_bytes: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max_bytes);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut buffer = Vec::new();
    file.take(max_bytes).read_to_end(&mut buffer).ok()?;
    let text = String::from_utf8_lossy(&buffer).to_string();
    if start == 0 {
        return Some(text);
    }
    // 从中间切进来时首行多半是半截，去掉它
    match text.find('\n') {
        Some(index) => Some(text[index + 1..].to_string()),
        None => Some(text),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "cogito-diag-cmd-{tag}-{}-{}",
            std::process::id(),
            diagnostics::now_ms()
        ));
        fs::create_dir_all(&dir).expect("创建临时目录");
        dir
    }

    #[test]
    fn dir_kind_rejects_unknown() {
        assert!(dir_for_kind("nope").is_err());
        assert!(dir_for_kind("log").is_ok());
        assert!(dir_for_kind("crash").is_ok());
    }

    #[test]
    fn variant_normalization_defaults_to_slim() {
        // 纯函数：不受运行环境里 CLIENT_SIDECAR_VARIANT 的残留值影响
        assert_eq!(normalize_variant(None), "slim");
        assert_eq!(normalize_variant(Some("")), "slim");
        assert_eq!(normalize_variant(Some("  ")), "slim");
        assert_eq!(normalize_variant(Some(" slim ")), "slim");
        assert_eq!(normalize_variant(Some("FULL")), "full");
        assert_eq!(normalize_variant(Some("nonsense")), "slim");
    }

    #[test]
    fn parse_level_maps_unknown_to_info() {
        assert_eq!(parse_level("ERROR"), log::Level::Error);
        assert_eq!(parse_level("fatal"), log::Level::Error);
        assert_eq!(parse_level("warning"), log::Level::Warn);
        assert_eq!(parse_level("nonsense"), log::Level::Info);
    }

    #[test]
    fn append_truncates_long_lines() {
        let huge = "x".repeat(MAX_LOG_LINE_CHARS * 2);
        let entries = vec![FrontendLogEntry {
            level: "error".into(),
            message: huge,
            target: Some("test".into()),
            window: Some("main".into()),
            timestamp: Some(1),
        }];
        assert_eq!(diagnostics_append(entries), 1);
    }

    #[test]
    fn append_caps_batch_size() {
        let entries: Vec<FrontendLogEntry> = (0..(MAX_LOG_BATCH + 50))
            .map(|index| FrontendLogEntry {
                level: "info".into(),
                message: format!("line-{index}"),
                target: None,
                window: None,
                timestamp: None,
            })
            .collect();
        assert_eq!(diagnostics_append(entries), MAX_LOG_BATCH);
    }

    #[test]
    fn log_tail_drops_partial_first_line() {
        let dir = temp_dir("tail");
        let path = dir.join("cogito.log");
        let mut file = fs::File::create(&path).expect("建日志");
        writeln!(file, "first-line-should-be-dropped-xxxxxxxxxx").expect("写");
        writeln!(file, "second-line").expect("写");
        writeln!(file, "third-line").expect("写");
        drop(file);

        let tail = read_tail_from(&path, 15).expect("读尾部");
        assert!(!tail.contains("first-line"), "被截断的首行要丢掉: {tail}");
        assert!(tail.contains("third-line"), "尾部要保留最新行: {tail}");

        // 文件比上限小 → 全量返回，不丢首行
        let full = read_tail_from(&path, 4096).expect("读全文");
        assert!(full.contains("first-line"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn newest_log_file_picks_latest() {
        let dir = temp_dir("newest");
        let older = dir.join("cogito.log");
        let newer = dir.join("cogito.1.log");
        fs::write(&older, "a").expect("写");
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&newer, "b").expect("写");
        let picked = newest_log_file(&dir).expect("应有日志");
        assert_eq!(picked, newer);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_log_dir_returns_none() {
        let dir = temp_dir("empty");
        assert!(read_log_tail(&dir, 1024).is_none(), "空目录不该 panic");
        let _ = fs::remove_dir_all(&dir);
    }
}
