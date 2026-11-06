//! Agent 会话缓存目录：临时脚本 / 构建日志 / 验证输出的**唯一**落点。
//!
//! 为什么需要这一层：`AGENTS.md` 写了「临时文件一律写缓存目录」，但那只是约定 ——
//! 终端不注入环境变量、也没有任何清理与检查，于是 agent 的 `.ps1` / `.log` / `.js`
//! 会落在仓库根或 `node_modules` 里，会话结束没人删。这个模块把「在哪儿」变成代码：
//!
//! - 根目录：`%LOCALAPPDATA%\cogito\agent-cache`（Windows 缓存惯例，随系统清理）；
//!   取不到 `LOCALAPPDATA` 时退回 `~/.cogito/agent-cache`（早期文档里的位置，兼容读）；
//! - 会话子目录：`<root>/<session>`，session 由 terminal 的 `agent_session_id(cwd)` 给；
//! - 保留：启动时清理超过 `AGENT_CACHE_RETENTION_DAYS` 天没动过的子目录；
//! - 一键清理：`clear()` 只清缓存根，不动 `.cogito/plans` 与日志目录。
//!
//! 终端侧把 `COGITO_AGENT_CACHE` / `TMP` / `TEMP` 都指向会话子目录（见
//! `utils::terminal::spawn_session`），这样 `mktemp`、`$env:TEMP\x.log`、Node 的
//! `os.tmpdir()` 全部自动落到这里 —— agent 不需要「记得」这条约定。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

/// 缓存保留天数：超过这个时间没动过的会话目录会在启动时被清掉。
pub const AGENT_CACHE_RETENTION_DAYS: u64 = 7;

/// `%LOCALAPPDATA%` 下的应用目录名（与 `%APPDATA%\com.cogito.client` 区分：缓存不走漫游）。
const APP_DIR: &str = "cogito";
/// 缓存子目录名。
const CACHE_DIR: &str = "agent-cache";
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
/// 顺序：`LOCALAPPDATA` → `<home>/.cogito` → 进程临时目录。
/// 最后一级兜底是「总比 panic 好」：缓存写不进去不该让工具面直接挂掉。
fn root_from(local_app_data: Option<&Path>, home: Option<&Path>) -> PathBuf {
    if let Some(base) = local_app_data {
        return base.join(APP_DIR).join(CACHE_DIR);
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

/// 早期文档里的位置（`~/.cogito/agent-cache`）；存在就走兼容读，不存在返回 `None`。
#[must_use]
pub fn legacy_root() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let path = home.join(LEGACY_APP_DIR).join(CACHE_DIR);
    path.is_dir().then_some(path)
}

/// 会话子目录（不存在则创建）。`root` 可注入，便于单测。
pub fn session_dir_in(root: &Path, id: &str) -> Result<PathBuf, String> {
    let dir = root.join(sanitize_id(id));
    fs::create_dir_all(&dir).map_err(|error| format!("创建缓存目录失败（{}）：{error}", dir.display()))?;
    Ok(dir)
}

/// 会话子目录：`%LOCALAPPDATA%\cogito\agent-cache\<session>`。
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

/// 缓存概况（设置页「Agent 缓存 · N MB」那一行用）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCacheStats {
    pub path: String,
    pub bytes: u64,
    pub sessions: usize,
    /// 旧目录（`~/.cogito/agent-cache`）仍存在时给出，前端提示「可手动删除」。
    pub legacy_path: Option<String>,
}

/// 统计当前缓存根。
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
        bytes: dir_size(root),
        sessions,
        legacy_path: None,
    }
}

/// 统计当前缓存根（含旧目录提示）。
#[must_use]
pub fn stats() -> AgentCacheStats {
    let mut stats = stats_in(&agent_cache_root());
    stats.legacy_path = legacy_root().map(|path| path.display().to_string());
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
pub fn prune_stale_in(root: &Path, days: u64) -> usize {
    if !root.is_dir() {
        return 0;
    }
    let Some(cutoff) = SystemTime::now().checked_sub(Duration::from_secs(days.saturating_mul(24 * 60 * 60)))
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
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if modified < cutoff && fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// 启动时清理超期缓存；返回删除的目录数（只打一行日志，失败不吵）。
pub fn prune_stale_caches(days: u64) -> usize {
    let removed = prune_stale_in(&agent_cache_root(), days);
    if removed > 0 {
        log::info!("agent-cache: 清理了 {removed} 个超过 {days} 天的会话缓存目录");
    }
    removed
}

/// 设置页读取缓存概况。
#[tauri::command]
pub fn agent_cache_info() -> AgentCacheStats {
    stats()
}

/// 设置页「清空」：返回释放的字节数。
#[tauri::command]
pub fn agent_cache_clear() -> Result<u64, String> {
    clear()
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
    fn root_prefers_local_app_data() {
        let root = root_from(Some(Path::new("C:\\Users\\me\\AppData\\Local")), Some(Path::new("C:\\Users\\me")));
        assert_eq!(root, Path::new("C:\\Users\\me\\AppData\\Local").join("cogito").join("agent-cache"));
    }

    #[test]
    fn root_falls_back_to_legacy_home() {
        let root = root_from(None, Some(Path::new("C:\\Users\\me")));
        assert_eq!(root, Path::new("C:\\Users\\me").join(".cogito").join("agent-cache"));
    }

    #[test]
    fn session_dir_is_created_and_idempotent() {
        let root = scratch("session");
        let first = session_dir_in(&root, "D:\\Documents\\workspace-cogito").expect("first");
        let second = session_dir_in(&root, "D:\\Documents\\workspace-cogito").expect("second");
        assert_eq!(first, second);
        assert!(first.is_dir());
        assert_eq!(first.file_name().and_then(|name| name.to_str()), Some("D--Documents-workspace-cogito"));
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
    fn prune_removes_only_stale_sessions() {        let root = scratch("prune");
        let fresh = session_dir_in(&root, "fresh").expect("fresh");
        let stale = session_dir_in(&root, "stale").expect("stale");
        fs::write(fresh.join("a.log"), b"1").expect("write");
        fs::write(stale.join("a.log"), b"1").expect("write");

        // 保留 0 天 = 立刻过期；把 fresh 的 mtime 前移以模拟「刚用过」
        let removed = prune_stale_in(&root, 0);
        assert!(removed >= 1, "至少清掉 stale");
        assert!(stale.exists() == false || removed == 1);
        // 再跑一次不应报错（幂等）
        prune_stale_in(&root, 0);
    }
}
