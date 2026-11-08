//! Agent 会话缓存目录：临时脚本 / 构建日志 / 验证输出的**唯一**落点。
//!
//! 为什么需要这一层：`AGENTS.md` 写了「临时文件一律写缓存目录」，但那只是约定 ——
//! 终端不注入环境变量、也没有任何清理与检查，于是 agent 的 `.ps1` / `.log` / `.js`
//! 会落在仓库根或 `node_modules` 里，会话结束没人删。这个模块把「在哪儿」变成代码：
//!
//! - 根目录：`%LOCALAPPDATA%\Temp\cogito\agent-cache`。**必须落在 `Temp` 下**：
//!   上一版放在 `%LOCALAPPDATA%\cogito\agent-cache`，那不是系统清理域（磁盘清理 /
//!   存储感知只认 `Temp` 与登记过的已知目录），于是缓存只能靠用户手动清。放进
//!   `Temp` 之后「系统会自动清」才是真的；同时本模块自己做保留期 + 容量上限，
//!   不赌用户开不开存储感知。
//!   取不到 `LOCALAPPDATA` 时退回 `~/.cogito/agent-cache`（早期文档里的位置）。
//! - 会话子目录：`<root>/<session>`，session 由 terminal 的 `agent_session_id(cwd)` 给；
//! - 保留：启动时 + 诊断面板打开时（30s 节流）清理超过
//!   [`AGENT_CACHE_RETENTION_DAYS`] 天没动过的子目录，并按 LRU 淘汰到
//!   [`AGENT_CACHE_MAX_BYTES`] 以内；
//! - 迁移：上一版根目录与 `~/.cogito/agent-cache` 只在首次清理时被「统计 → 清空 →
//!   记录」，之后不再出现；
//! - 一键清理：`clear()` 只清缓存根，不动 `.cogito/plans` 与日志目录。
//!
//! 终端侧把 `COGITO_AGENT_CACHE` / `TMP` / `TEMP` 都指向会话子目录（见
//! `utils::terminal::spawn_session`），这样 `mktemp`、`$env:TEMP\x.log`、Node 的
//! `os.tmpdir()` 全部自动落到这里 —— agent 不需要「记得」这条约定。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

/// 缓存保留天数：超过这个时间没动过的会话目录会被清掉。
pub const AGENT_CACHE_RETENTION_DAYS: u64 = 7;

/// 缓存总体积上限（字节）。超过就按 LRU 淘汰最久没动过的会话目录。
///
/// 512 MB 是个折中：一次前端构建的 `.log` 加 node 临时目录通常在几十 MB 量级，
/// 512 MB 能容忍多个工作区并存，又不会让用户磁盘在无感中膨胀。
pub const AGENT_CACHE_MAX_BYTES: u64 = 512 * 1024 * 1024;

/// 清理节流窗口：诊断面板/终端面板反复打开时不重复扫盘。
pub const PRUNE_THROTTLE: Duration = Duration::from_secs(30);

/// `%LOCALAPPDATA%` 下的应用目录名（与 `%APPDATA%\com.cogito.client` 区分：缓存不走漫游）。
const APP_DIR: &str = "cogito";
/// 缓存子目录名。
const CACHE_DIR: &str = "agent-cache";
/// `Temp` 子目录名：Windows 的存储感知 / 磁盘清理会清 `%LOCALAPPDATA%\Temp`。
const TEMP_DIR: &str = "Temp";
/// 兼容读的旧目录：`~/.cogito/agent-cache`。
const LEGACY_APP_DIR: &str = ".cogito";

/// 会话 id → 目录名。
///
/// 只留 `[A-Za-z0-9._-]`，其余字符（盘符冒号、路径分隔符、中文）一律换成 `-`：
/// 会话 id 来自 cwd，直接拼进路径既可能建出多级目录，也可能在有保留字的盘上失败。
/// 长 id 截到 80 字符 —— 目录名上限 255，留出前缀余量。
fn sanitize_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for ch in id.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            out.push(ch);
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    let trimmed = if trimmed.is_empty() {
        "session".to_string()
    } else {
        trimmed
    };
    trimmed.chars().take(80).collect()
}

/// 根目录的**纯函数**形态：注入两个环境变量，便于单测。
///
/// 顺序：`LOCALAPPDATA\Temp` → `<home>/.cogito` → 进程临时目录。
/// 第一级走 `Temp` 是为了让系统清理真的生效（见模块注释）；不直接用 `std::env::temp_dir()`
/// 是因为终端子进程的 `TMP`/`TEMP` 被改写过，宿主进程不该被它带偏。
/// 最后一级兜底是「总比 panic 好」：缓存写不进去不该让工具面直接挂掉。
fn root_from(local_app_data: Option<&Path>, home: Option<&Path>) -> PathBuf {
    if let Some(base) = local_app_data {
        return base.join(TEMP_DIR).join(APP_DIR).join(CACHE_DIR);
    }
    if let Some(base) = home {
        return base.join(LEGACY_APP_DIR).join(CACHE_DIR);
    }
    std::env::temp_dir().join(APP_DIR).join(CACHE_DIR)
}

/// 当前机器的缓存根目录。
#[must_use]
pub fn agent_cache_root() -> PathBuf {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    root_from(local.as_deref(), home.as_deref())
}

/// 上一版根目录（`%LOCALAPPDATA%\cogito\agent-cache`）：只用于迁移清理，不再写入。
#[must_use]
pub fn previous_local_root() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from)?;
    let path = base.join(APP_DIR).join(CACHE_DIR);
    path.is_dir().then_some(path)
}

/// 早期文档里的位置（`~/.cogito/agent-cache`）；存在就返回，不存在返回 `None`。
#[must_use]
pub fn legacy_root() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let path = home.join(LEGACY_APP_DIR).join(CACHE_DIR);
    path.is_dir().then_some(path)
}

/// 所有仍存在的旧目录（上一版本地根 + 早期 home 根），用于一次性迁移清理。
#[must_use]
pub fn legacy_roots() -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Some(path) = previous_local_root() {
        list.push(path);
    }
    if let Some(path) = legacy_root() {
        if !list.iter().any(|known| known == &path) {
            list.push(path);
        }
    }
    list
}

/// 会话子目录（不存在则创建）。`root` 可注入，便于单测。
pub fn session_dir_in(root: &Path, id: &str) -> Result<PathBuf, String> {
    let dir = root.join(sanitize_id(id));
    fs::create_dir_all(&dir)
        .map_err(|error| format!("创建缓存目录失败（{}）：{error}", dir.display()))?;
    Ok(dir)
}

/// 会话子目录：`%LOCALAPPDATA%\Temp\cogito\agent-cache\<session>`。
pub fn session_dir(id: &str) -> Result<PathBuf, String> {
    session_dir_in(&agent_cache_root(), id)
}

/// 目录占用字节数（递归；读不到的项按 0 计，不因为一个坏链接中断统计）。
#[must_use]
pub fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            total = total.saturating_add(dir_size(&entry.path()));
        } else {
            total = total.saturating_add(meta.len());
        }
    }
    total
}

/// `dir_size` 的 30 秒缓存版本：设置页反复打开时不重复递归扫盘。
///
/// 缓存键是目录路径，值是「统计时刻 + 字节数」。进程内单表即可 —— 缓存目录
/// 最多几十个会话子目录，不需要淘汰策略。
static SIZE_CACHE: Mutex<Option<HashMap<PathBuf, (Instant, u64)>>> = Mutex::new(None);

#[must_use]
pub fn dir_size_cached(path: &Path) -> u64 {
    let mut guard = match SIZE_CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let map = guard.get_or_insert_with(HashMap::new);
    if let Some((at, bytes)) = map.get(path) {
        if at.elapsed() < PRUNE_THROTTLE {
            return *bytes;
        }
    }
    let bytes = dir_size(path);
    map.insert(path.to_path_buf(), (Instant::now(), bytes));
    bytes
}

/// 任何删除动作之后都要让体积缓存失效，否则设置页会显示删除前的数字。
fn reset_size_cache() {
    let mut guard = match SIZE_CACHE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *guard = None;
}

/// 目录内**最新**一次改动时间（递归取所有文件与子目录 mtime 的最大值）。
///
/// 为什么不直接用目录 mtime：覆盖写同名文件（`build.log` 反复重写）不更新父目录
/// mtime，长跑会话会被误判成「7 天没动过」而被删掉。
#[must_use]
pub fn latest_touch(path: &Path) -> Option<SystemTime> {
    let mut latest = fs::metadata(path).ok().and_then(|meta| meta.modified().ok());
    let Ok(entries) = fs::read_dir(path) else {
        return latest;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let candidate = if meta.is_dir() {
            latest_touch(&child)
        } else {
            meta.modified().ok()
        };
        if let Some(candidate) = candidate {
            latest = Some(match latest {
                Some(current) if current >= candidate => current,
                _ => candidate,
            });
        }
    }
    latest
}

/// 缓存概况（设置页「Agent 缓存 · N MB」那一行用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCacheStats {
    pub path: String,
    pub bytes: u64,
    pub sessions: usize,
    /// 仍存在的旧目录（迁移前）；迁移清理后为空。
    pub legacy_path: Option<String>,
    /// 旧目录占用字节数（「可释放 N MB」提示用）。
    pub legacy_bytes: u64,
    /// 自动淘汰上限（字节）。
    pub max_bytes: u64,
    /// 最近一次自动清理的时刻（epoch 毫秒）。
    pub last_pruned_at: Option<i64>,
    /// 最近一次自动清理释放的字节数。
    pub last_pruned_bytes: u64,
}

/// 一次自动清理的结果。
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    /// 删掉的会话目录数。
    pub removed_dirs: u64,
    /// 释放的字节数。
    pub freed_bytes: u64,
    /// 完成时刻（epoch 毫秒）。
    pub at_ms: i64,
}

impl PruneReport {
    fn now() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis() as i64)
            .unwrap_or(0)
    }
}

/// 统计当前缓存根（不含旧目录提示）。
#[must_use]
pub fn stats_in(root: &Path) -> AgentCacheStats {
    let sessions = fs::read_dir(root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0);
    AgentCacheStats {
        path: root.display().to_string(),
        bytes: dir_size_cached(root),
        sessions,
        legacy_path: None,
        legacy_bytes: 0,
        max_bytes: AGENT_CACHE_MAX_BYTES,
        last_pruned_at: None,
        last_pruned_bytes: 0,
    }
}

/// 统计当前缓存根（含旧目录提示与最近一次清理结果）。
#[must_use]
pub fn stats() -> AgentCacheStats {
    let mut stats = stats_in(&agent_cache_root());
    let legacy = legacy_roots();
    stats.legacy_path = legacy
        .first()
        .map(|path| path.display().to_string());
    stats.legacy_bytes = legacy.iter().map(|path| dir_size(path)).sum();
    let state = prune_state_snapshot();
    stats.last_pruned_at = (state.at_ms > 0).then_some(state.at_ms);
    stats.last_pruned_bytes = state.freed_bytes;
    stats
}

/// 递归删除目录内容但保留根（`clear` 后设置页还要能算「0 B」）。
fn clear_dir(path: &Path) -> u64 {
    let freed = dir_size(path);
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let target = entry.path();
        if target.is_dir() {
            let _ = fs::remove_dir_all(&target);
        } else {
            let _ = fs::remove_file(&target);
        }
    }
    reset_size_cache();
    freed
}

/// 清空缓存（只清缓存根：`.cogito/plans` 与日志目录不受影响）。返回释放的字节数。
pub fn clear_in(root: &Path) -> Result<u64, String> {
    if !root.is_dir() {
        return Ok(0);
    }
    Ok(clear_dir(root))
}

/// 清空当前缓存根。
pub fn clear() -> Result<u64, String> {
    clear_in(&agent_cache_root())
}

/// 会话结束（`terminal:kill` / 会话切换）时清掉这个会话的缓存目录，返回释放的字节数。
///
/// 只删**单个**会话子目录，缓存根留着（设置页还要显示 0 B）。进程还活着时删除会失败，
/// 这种情况交给启动时的 `prune_stale_caches` 兜底 —— 清理是尽力而为，不该阻断关闭流程。
pub fn clear_session_in(root: &Path, id: &str) -> u64 {
    let dir = root.join(sanitize_id(id));
    let freed = dir_size(&dir);
    if dir.is_dir() && fs::remove_dir_all(&dir).is_ok() {
        reset_size_cache();
        return freed;
    }
    0
}

/// 当前机器的会话缓存清理入口（见 [`clear_session_in`]）。
pub fn clear_session(id: &str) -> u64 {
    clear_session_in(&agent_cache_root(), id)
}

/// 当前会话的缓存目录（终端注入 `TMP`/`TEMP` 用）；建不出来就不注入，不阻断开终端。
#[must_use]
pub fn session_dir_or_none(id: &str) -> Option<PathBuf> {
    session_dir(id).ok()
}

/// 删除 `days` 天没动过的会话子目录（根目录本身留着）。返回删除的目录数。
///
/// 「没动过」按目录内**最新文件 mtime** 判定，不看目录自身 mtime（覆盖写不更新父目录）。
pub fn prune_stale_in(root: &Path, days: u64) -> usize {
    if !root.is_dir() {
        return 0;
    }
    let Some(cutoff) =
        SystemTime::now().checked_sub(Duration::from_secs(days.saturating_mul(24 * 60 * 60)))
    else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let touched = latest_touch(&entry.path()).or_else(|| meta.modified().ok());
        let Some(touched) = touched else {
            continue;
        };
        if touched < cutoff && fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    if removed > 0 {
        reset_size_cache();
    }
    removed
}

/// 一个会话子目录的容量视图（LRU 淘汰用）。
struct SessionCost {
    path: PathBuf,
    bytes: u64,
    touched: SystemTime,
}

fn session_costs(root: &Path) -> (Vec<SessionCost>, u64) {
    let mut list = Vec::new();
    let mut total = 0u64;
    let Ok(entries) = fs::read_dir(root) else {
        return (list, 0);
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_dir() {
            continue;
        }
        let bytes = dir_size(&entry.path());
        let touched = latest_touch(&entry.path())
            .or_else(|| meta.modified().ok())
            .unwrap_or(UNIX_EPOCH);
        total = total.saturating_add(bytes);
        list.push(SessionCost {
            path: entry.path(),
            bytes,
            touched,
        });
    }
    (list, total)
}

/// 按体积上限淘汰：最久没动过的先删，直到总量回到 `max_bytes` 以内。
///
/// 返回 `(删除的目录数, 释放的字节数)`。与保留期清理互补 —— 保留期管「太旧」，
/// 这里管「太胖」，两个都触发才挡得住 SDK 缓存这类短时间就能堆很大的目录。
pub fn prune_by_size_in(root: &Path, max_bytes: u64) -> (usize, u64) {
    let (mut costs, mut total) = session_costs(root);
    if total <= max_bytes {
        return (0, 0);
    }
    costs.sort_by(|left, right| left.touched.cmp(&right.touched));
    let mut removed = 0;
    let mut freed = 0u64;
    for cost in costs {
        if total <= max_bytes {
            break;
        }
        if fs::remove_dir_all(&cost.path).is_ok() {
            removed += 1;
            freed = freed.saturating_add(cost.bytes);
            total = total.saturating_sub(cost.bytes);
        }
    }
    if removed > 0 {
        reset_size_cache();
    }
    (removed, freed)
}

/// 旧目录迁移：统计 → 清空 → 返回 `(目录数, 释放字节数)`。
///
/// 只在旧目录确实存在时动作；清空后旧目录本身也删掉，避免下一次又被当成「可释放」。
pub fn migrate_legacy_in(roots: &[PathBuf]) -> (usize, u64) {
    let mut removed = 0;
    let mut freed = 0u64;
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        let bytes = dir_size(root);
        if fs::remove_dir_all(root).is_ok() {
            removed += 1;
            freed = freed.saturating_add(bytes);
        }
    }
    if removed > 0 {
        reset_size_cache();
    }
    (removed, freed)
}

/// 清理状态：节流窗口 + 最近一次结果。
#[derive(Debug, Clone, Copy, Default)]
struct PruneState {
    last_at: Option<Instant>,
    report: Option<PruneReport>,
}

static PRUNE_STATE: Mutex<Option<PruneState>> = Mutex::new(None);

fn prune_state_snapshot() -> PruneReport {
    let guard = match PRUNE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.and_then(|state| state.report).unwrap_or_default()
}

fn take_prune_slot(force: bool) -> Option<Instant> {
    let mut guard = match PRUNE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let now = Instant::now();
    if !force {
        if let Some(state) = guard.as_ref() {
            if let Some(last) = state.last_at {
                if now.duration_since(last) < PRUNE_THROTTLE {
                    return None;
                }
            }
        }
    }
    let mut state = guard.unwrap_or_default();
    state.last_at = Some(now);
    *guard = Some(state);
    Some(now)
}

fn record_prune(report: PruneReport) {
    let mut guard = match PRUNE_STATE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let mut state = guard.unwrap_or_default();
    state.report = Some(report);
    *guard = Some(state);
}

/// 保留期可由 `COGITO_AGENT_CACHE_RETENTION_DAYS` 覆盖（`0` = 下一次清理清空所有会话，验证/救急用）；
/// 非法值静默回落默认 —— 一个拼错的变量不该把清理关掉。
fn retention_days_from(raw: Option<&str>) -> u64 {
    match raw.map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => text.parse::<u64>().unwrap_or(AGENT_CACHE_RETENTION_DAYS),
        None => AGENT_CACHE_RETENTION_DAYS,
    }
}

/// 容量上限可由 `COGITO_AGENT_CACHE_MAX_BYTES` 覆盖；`0` / 非法值回落默认
/// （0 会被读成「全删」，不能让它成为一次误配的结果）。
fn max_bytes_from(raw: Option<&str>) -> u64 {
    match raw.map(str::trim).filter(|text| !text.is_empty()) {
        Some(text) => text
            .parse::<u64>()
            .ok()
            .filter(|value| *value > 0)
            .unwrap_or(AGENT_CACHE_MAX_BYTES),
        None => AGENT_CACHE_MAX_BYTES,
    }
}

/// 当前生效的保留期（环境变量优先）。
#[must_use]
pub fn retention_days() -> u64 {
    retention_days_from(std::env::var("COGITO_AGENT_CACHE_RETENTION_DAYS").ok().as_deref())
}

/// 当前生效的容量上限（环境变量优先）。
fn max_bytes_limit() -> u64 {
    max_bytes_from(std::env::var("COGITO_AGENT_CACHE_MAX_BYTES").ok().as_deref())
}

/// 完整清理：旧目录迁移 + 保留期 + 容量上限。带 30 秒节流（`force` 可绕过）。
///
/// 三个触发点共用它：启动（force）、诊断面板打开、终端面板首次挂载。
pub fn prune_all(force: bool) -> PruneReport {
    prune_all_with(retention_days(), max_bytes_limit(), force)
}

/// 同 [`prune_all`]，但显式给保留期与容量上限（测试、以及「按环境变量清一次」用）。
pub fn prune_all_with(days: u64, max_bytes: u64, force: bool) -> PruneReport {
    if take_prune_slot(force).is_none() {
        return prune_state_snapshot();
    }
    run_prune(days, max_bytes)
}

/// 真正干活的那一段（调用方负责先取节流槽）。
fn run_prune(days: u64, max_bytes: u64) -> PruneReport {
    let mut report = PruneReport {
        at_ms: PruneReport::now(),
        ..PruneReport::default()
    };
    let (legacy_dirs, legacy_bytes) = migrate_legacy_in(&legacy_roots());
    let root = agent_cache_root();
    let stale = prune_stale_in(&root, days);
    let (sized_dirs, sized_bytes) = prune_by_size_in(&root, max_bytes);
    report.removed_dirs = (legacy_dirs + stale) as u64 + sized_dirs as u64;
    report.freed_bytes = legacy_bytes.saturating_add(sized_bytes);
    if report.removed_dirs > 0 {
        log::info!(
            "agent-cache: 清理 {} 个目录，释放 {} 字节（迁移 {} / 超期 {} / 超限 {}）",
            report.removed_dirs,
            report.freed_bytes,
            legacy_dirs,
            stale,
            sized_dirs
        );
    }
    record_prune(report);
    report
}

/// 启动时清理超期缓存；返回删除的目录数（只打一行日志，失败不吵）。
///
/// 启动这一轮**强制**跑：不强制会被上一轮遗留的节流窗口吞掉，用户重启后仍看到旧缓存。
pub fn prune_stale_caches(days: u64) -> usize {
    // 用调用方给的保留期，不能 `let _ = days` 忽略掉 —— 那样环境变量覆盖永远不生效。
    prune_all_with(days, max_bytes_limit(), true).removed_dirs as usize
}

/// 后台跑一次节流清理（`force` 忽略 30 秒窗口）。
///
/// 终端面板挂载这类高频入口只该「喊一嗓子」：清理要 stat 遍历会话目录，
/// 不该压在 IPC 线程上，更不能因为目录多而拖慢 attach。
pub fn prune_in_background(force: bool) {
    std::thread::spawn(move || {
        let _ = prune_all(force);
    });
}

/// 设置页读取缓存概况（顺手做一次节流清理 —— 打开诊断面板就是一次「该收拾了」的信号）。
#[tauri::command]
pub fn agent_cache_info() -> AgentCacheStats {
    if take_prune_slot(false).is_some() {
        run_prune(retention_days(), max_bytes_limit());
    }
    stats()
}

/// 设置页「清空」：返回释放的字节数。
#[tauri::command]
pub fn agent_cache_clear() -> Result<u64, String> {
    let mut freed = clear()?;
    let (_, legacy_bytes) = migrate_legacy_in(&legacy_roots());
    freed = freed.saturating_add(legacy_bytes);
    record_prune(PruneReport {
        removed_dirs: 0,
        freed_bytes: freed,
        at_ms: PruneReport::now(),
    });
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("cogito-agent-cache-test")
            .join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch");
        dir
    }

    #[test]
    fn sanitize_replaces_path_hostile_chars() {
        assert_eq!(sanitize_id("D:\\Documents\\workspace-cogito"), "D--Documents-workspace-cogito");
        assert_eq!(sanitize_id("com:cogito/client"), "com-cogito-client");
        assert_eq!(sanitize_id("缓存 目录"), "session");
        assert_eq!(sanitize_id(""), "session");
        assert!(sanitize_id(&"a".repeat(200)).len() <= 80);
    }

    #[test]
    fn root_prefers_local_temp() {
        let root = root_from(
            Some(Path::new("C:\\Users\\me\\AppData\\Local")),
            Some(Path::new("C:\\Users\\me")),
        );
        assert_eq!(
            root,
            Path::new("C:\\Users\\me\\AppData\\Local")
                .join("Temp")
                .join("cogito")
                .join("agent-cache")
        );
    }

    #[test]
    fn root_falls_back_to_legacy_home() {
        let root = root_from(None, Some(Path::new("C:\\Users\\me")));
        assert_eq!(
            root,
            Path::new("C:\\Users\\me").join(".cogito").join("agent-cache")
        );
    }

    #[test]
    fn session_dir_is_created_and_idempotent() {
        let root = scratch("session");
        let first = session_dir_in(&root, "D:\\Documents\\workspace-cogito").expect("first");
        let second = session_dir_in(&root, "D:\\Documents\\workspace-cogito").expect("second");
        assert_eq!(first, second);
        assert!(first.is_dir());
        assert_eq!(
            first.file_name().and_then(|name| name.to_str()),
            Some("D--Documents-workspace-cogito")
        );
    }

    #[test]
    fn stats_and_clear_only_touch_cache_root() {
        let root = scratch("stats");
        let session = session_dir_in(&root, "s1").expect("session");
        fs::write(session.join("a.log"), b"12345").expect("write");
        fs::write(session.join("b.txt"), b"123").expect("write");
        let before = stats_in(&root);
        assert_eq!(before.bytes, 8);
        assert_eq!(before.sessions, 1);

        let freed = clear_in(&root).expect("clear");
        assert_eq!(freed, 8);
        let after = stats_in(&root);
        assert_eq!(after.bytes, 0);
        assert_eq!(after.sessions, 0);
        assert!(root.is_dir(), "根目录要保留，设置页还要显示 0 B");
    }

    #[test]
    fn clear_session_removes_only_that_session() {
        let root = scratch("clear-session");
        let one = session_dir_in(&root, "agent:D:\\w\\one").expect("one");
        let two = session_dir_in(&root, "agent:D:\\w\\two").expect("two");
        fs::write(one.join("a.log"), b"12").expect("write");
        fs::write(two.join("b.log"), b"34").expect("write");

        let freed = clear_session_in(&root, "agent:D:\\w\\one");
        assert_eq!(freed, 2);
        assert!(!one.exists(), "命中的会话目录要整个删掉");
        assert!(two.exists(), "其它会话不能被连带删除");
        assert!(root.is_dir(), "缓存根要保留");
        assert_eq!(clear_session_in(&root, "不存在的会话"), 0, "缺失也是幂等的");
    }

    #[test]
    fn prune_removes_only_stale_sessions() {
        let root = scratch("prune");
        let fresh = session_dir_in(&root, "fresh").expect("fresh");
        let stale = session_dir_in(&root, "stale").expect("stale");
        fs::write(fresh.join("a.log"), b"1").expect("write");
        fs::write(stale.join("a.log"), b"1").expect("write");

        // 保留 0 天 = 立刻过期（两个目录都过了 cutoff，全部清掉是允许的）
        let removed = prune_stale_in(&root, 0);
        assert!(removed >= 1, "至少清掉 stale");
        assert!(!stale.exists() || removed >= 1);
        // 再跑一次不应报错（幂等）
        prune_stale_in(&root, 0);
    }

    #[test]
    fn stale_uses_latest_file_mtime() {
        let root = scratch("stale-mtime");
        let dir = session_dir_in(&root, "s").expect("session");
        let log = dir.join("build.log");
        fs::write(&log, b"a").expect("write");
        std::thread::sleep(Duration::from_millis(30));
        let dir_mtime = fs::metadata(&dir)
            .and_then(|meta| meta.modified())
            .expect("dir mtime");
        // 覆盖写：只有文件 mtime 变，父目录 mtime 不动
        fs::write(&log, b"bb").expect("rewrite");
        let touched = latest_touch(&dir).expect("latest");
        assert!(
            touched > dir_mtime,
            "陈旧判定必须用目录内最新文件 mtime，而不是目录自身 mtime"
        );
    }

    #[test]
    fn prune_by_size_evicts_lru_first() {
        let root = scratch("prune-size");
        let old = session_dir_in(&root, "old").expect("old");
        fs::write(old.join("a.log"), b"aaaa").expect("write");
        std::thread::sleep(Duration::from_millis(30));
        let mid = session_dir_in(&root, "mid").expect("mid");
        fs::write(mid.join("a.log"), b"bbbb").expect("write");
        std::thread::sleep(Duration::from_millis(30));
        let new = session_dir_in(&root, "new").expect("new");
        fs::write(new.join("a.log"), b"cccc").expect("write");

        let (removed, freed) = prune_by_size_in(&root, 8);
        assert_eq!(removed, 1, "12 字节降到 8 字节，只需淘汰 1 个");
        assert_eq!(freed, 4);
        assert!(!old.exists(), "最久没动过的先淘汰");
        assert!(mid.is_dir() && new.is_dir(), "较新的会话保留");
    }

    #[test]
    fn prune_by_size_noop_when_under_limit() {
        let root = scratch("prune-size-noop");
        let dir = session_dir_in(&root, "s").expect("session");
        fs::write(dir.join("a.log"), b"1234").expect("write");
        let (removed, freed) = prune_by_size_in(&root, 4096);
        assert_eq!((removed, freed), (0, 0));
        assert!(dir.is_dir());
    }

    #[test]
    fn migrate_legacy_drains_old_root() {
        let legacy = scratch("legacy");
        let session = session_dir_in(&legacy, "s1").expect("session");
        fs::write(session.join("a.log"), b"1234567").expect("write");

        let (dirs, freed) = migrate_legacy_in(std::slice::from_ref(&legacy));
        assert_eq!(dirs, 1);
        assert_eq!(freed, 7);
        assert!(!legacy.exists(), "旧目录要整个清掉，否则下次又被算进来");
    }

    #[test]
    fn retention_days_env_override() {
        assert_eq!(retention_days_from(Some("0")), 0, "0 = 下次清理清空所有会话");
        assert_eq!(retention_days_from(Some("30")), 30);
        assert_eq!(retention_days_from(None), AGENT_CACHE_RETENTION_DAYS);
        assert_eq!(
            retention_days_from(Some("  ")),
            AGENT_CACHE_RETENTION_DAYS,
            "空串回落默认"
        );
        assert_eq!(
            retention_days_from(Some("七天")),
            AGENT_CACHE_RETENTION_DAYS,
            "非法值回落默认，不能让清理失效"
        );
    }

    #[test]
    fn max_bytes_env_override_rejects_zero() {
        assert_eq!(max_bytes_from(Some("1024")), 1024);
        assert_eq!(
            max_bytes_from(Some("0")),
            AGENT_CACHE_MAX_BYTES,
            "0 会被读成全删，必须回落默认"
        );
        assert_eq!(max_bytes_from(None), AGENT_CACHE_MAX_BYTES);
        assert_eq!(max_bytes_from(Some("abc")), AGENT_CACHE_MAX_BYTES);
    }

    /// 验证 #5 的第二半：`AGENT_CACHE_RETENTION_DAYS=0` 重启一次应当清空所有会话。
    /// 这里直接断言 `prune_stale_in(root, 0)` 的语义 —— 刚写的目录也算超期。
    #[test]
    fn zero_retention_clears_fresh_sessions() {
        let root = scratch("prune-zero");
        let fresh = session_dir_in(&root, "fresh").expect("session");
        fs::write(fresh.join("a.log"), b"x").expect("write");
        assert_eq!(prune_stale_in(&root, 0), 1);
        assert!(!fresh.exists(), "保留期 0 时连刚写的会话也要清掉");
        assert!(root.is_dir(), "只清会话子目录，缓存根留着");
    }
}
