use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

use parking_lot::Mutex;

use super::session::head_id_hex;
use super::status::StatusR;

struct CacheEntry {
    fingerprint: String,
    status: StatusR,
    /// `invalidate` 后仍保留 status，供下次重算比对 `unchanged`
    is_valid: bool,
}

static STATUS_CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn root_key(cwd: &Path) -> String {
    cwd.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn status_payload_eq(left: &StatusR, right: &StatusR) -> bool {
    left.branch == right.branch
        && left.ahead == right.ahead
        && left.behind == right.behind
        && left.entries.len() == right.entries.len()
        && left
            .entries
            .iter()
            .zip(right.entries.iter())
            .all(|(a, b)| {
                a.path == b.path
                    && a.index_status == b.index_status
                    && a.worktree_status == b.worktree_status
            })
}

/// HEAD oid + index mtime/size；工作区改动靠 watch → invalidate，不靠此指纹。
pub fn compute_fingerprint(cwd: &Path, repo: Option<&gix::Repository>) -> String {
    let mut parts = Vec::with_capacity(4);
    if let Some(repo) = repo {
        if let Some(head) = head_id_hex(repo) {
            parts.push(format!("head:{head}"));
        }
    } else if let Ok(head) = std::fs::read_to_string(cwd.join(".git/HEAD")) {
        parts.push(format!("headfile:{}", head.trim()));
    }
    let index = cwd.join(".git/index");
    if let Ok(meta) = std::fs::metadata(&index) {
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        parts.push(format!("index:{}:{}", meta.len(), mtime));
    }
    parts.join("|")
}

pub enum StatusLookup {
    Hit(StatusR),
    Miss {
        fingerprint: String,
        previous: Option<StatusR>,
    },
}

pub fn status_cached(cwd: &Path, repo: Option<&gix::Repository>) -> StatusLookup {
    let key = root_key(cwd);
    let fingerprint = compute_fingerprint(cwd, repo);
    let cache = STATUS_CACHE.lock();
    if let Some(entry) = cache.get(&key) {
        if entry.is_valid && entry.fingerprint == fingerprint {
            return StatusLookup::Hit(entry.status.clone());
        }
        return StatusLookup::Miss {
            fingerprint,
            previous: Some(entry.status.clone()),
        };
    }
    StatusLookup::Miss {
        fingerprint,
        previous: None,
    }
}

pub fn store_status(cwd: &Path, fingerprint: String, status: StatusR) {
    let key = root_key(cwd);
    STATUS_CACHE.lock().insert(
        key,
        CacheEntry {
            fingerprint,
            status,
            is_valid: true,
        },
    );
}

/// 标记失效但保留上次 status，便于重算后比对 unchanged。
pub fn invalidate_status(cwd: &Path) {
    let key = root_key(cwd);
    let mut cache = STATUS_CACHE.lock();
    if let Some(entry) = cache.get_mut(&key) {
        entry.is_valid = false;
        entry.fingerprint.clear();
    }
}

/// 写操作成功后调用：丢掉指纹强制下次重算。
pub fn bump_status(cwd: &Path) {
    invalidate_status(cwd);
}

/// 重算后：与 previous 载荷相同则 unchanged。
pub fn mark_unchanged(previous: Option<&StatusR>, next: &StatusR) -> bool {
    previous
        .map(|prev| status_payload_eq(prev, next))
        .unwrap_or(false)
}

#[allow(dead_code)]
pub fn clear_all() {
    STATUS_CACHE.lock().clear();
}

#[allow(dead_code)]
pub fn cached_root_hint() -> Option<PathBuf> {
    STATUS_CACHE
        .lock()
        .keys()
        .next()
        .map(PathBuf::from)
}
