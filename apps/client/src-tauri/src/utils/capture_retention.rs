//! 捕获库保留策略：按天 / 数量 / 容量清理 capture 资产，并回收孤儿文件。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 孤儿文件保护窗口（毫秒）：录屏分段落盘等场景。
pub const ORPHAN_PROTECT_MS: u64 = 10 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionPolicy {
    pub kind: String,
    pub days: u64,
    pub count: u64,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub ids: Vec<String>,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct CaptureCandidate {
    pub id: String,
    pub file_path: String,
    pub size: u64,
    pub captured_at: i64,
    pub capture_kind: String,
    pub keep: bool,
    pub state: String,
    pub is_managed: bool,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CaptureMeta {
    source: Option<String>,
    keep: Option<bool>,
    state: Option<String>,
    capture_kind: Option<String>,
    is_managed: Option<bool>,
    captured_at: Option<i64>,
}

/// 从 asset 行解析捕获候选；非 capture 源返回 None。
pub fn parse_candidate(
    id: &str,
    file_path: &str,
    size: Option<i64>,
    created_at: i64,
    metadata: Option<&str>,
) -> Option<CaptureCandidate> {
    let meta: CaptureMeta = metadata
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(CaptureMeta {
            source: None,
            keep: None,
            state: None,
            capture_kind: None,
            is_managed: None,
            captured_at: None,
        });
    let source = meta.source.unwrap_or_default();
    if source != "capture" {
        return None;
    }
    Some(CaptureCandidate {
        id: id.to_string(),
        file_path: file_path.to_string(),
        size: size.unwrap_or(0).max(0) as u64,
        captured_at: meta.captured_at.unwrap_or(created_at),
        capture_kind: meta
            .capture_kind
            .unwrap_or_else(|| "screenshot".to_string()),
        keep: meta.keep.unwrap_or(false),
        state: meta.state.unwrap_or_else(|| "done".to_string()),
        is_managed: meta.is_managed.unwrap_or(false),
        source,
    })
}

/// 判断路径是否落在 captures 目录内（防越界删除）。
pub fn is_under_captures(file_path: &str, captures_dir: &Path) -> bool {
    let Ok(captures) = captures_dir.canonicalize() else {
        let normalized = file_path.replace('\\', "/").to_lowercase();
        let marker = captures_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("captures")
            .to_lowercase();
        return normalized.contains(&format!("/{marker}/"))
            || normalized.ends_with(&format!("/{marker}"));
    };
    let path = Path::new(file_path);
    let Ok(canonical) = path.canonicalize() else {
        let normalized = file_path.replace('\\', "/").to_lowercase();
        let captures_norm = captures.to_string_lossy().replace('\\', "/").to_lowercase();
        return normalized.starts_with(&captures_norm);
    };
    canonical.starts_with(&captures)
}

/// 按策略计算应删除的候选 id（不含 keep / recording）。
pub fn find_prune_ids(
    candidates: &[CaptureCandidate],
    policies: &[RetentionPolicy],
    now_ms: i64,
) -> HashSet<String> {
    let mut doomed = HashSet::new();
    for policy in policies {
        let mut group: Vec<&CaptureCandidate> = candidates
            .iter()
            .filter(|c| {
                c.capture_kind == policy.kind
                    && !c.keep
                    && c.state != "recording"
                    && c.source == "capture"
            })
            .collect();
        group.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));

        let cutoff = now_ms.saturating_sub((policy.days as i64).saturating_mul(86_400_000));
        for item in &group {
            if item.captured_at < cutoff {
                doomed.insert(item.id.clone());
            }
        }

        if policy.count > 0 {
            for item in group.iter().skip(policy.count as usize) {
                doomed.insert(item.id.clone());
            }
        } else {
            for item in &group {
                doomed.insert(item.id.clone());
            }
        }

        let mut used: u64 = 0;
        for item in &group {
            used = used.saturating_add(item.size);
            if used > policy.max_bytes {
                doomed.insert(item.id.clone());
            }
        }
    }
    doomed
}

/// 删除目录中未被引用、且 mtime 早于保护窗口的文件，返回释放字节。
pub fn prune_orphans(
    dir: &Path,
    referenced: &HashSet<String>,
    now: SystemTime,
    protect: Duration,
) -> u64 {
    if !dir.is_dir() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut freed = 0u64;
    let referenced_norm: HashSet<String> = referenced
        .iter()
        .map(|p| p.replace('\\', "/").to_lowercase())
        .collect();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let path_norm = path.to_string_lossy().replace('\\', "/").to_lowercase();
        if referenced_norm.contains(&path_norm) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if now
            .duration_since(modified)
            .map(|d| d < protect)
            .unwrap_or(true)
        {
            continue;
        }
        let size = meta.len();
        if fs::remove_file(&path).is_ok() {
            freed = freed.saturating_add(size);
        }
    }
    freed
}

/// 对选中的 managed 文件尝试删除（必须在 captures 内）。
pub fn remove_managed_files(
    candidates: &[CaptureCandidate],
    ids: &HashSet<String>,
    captures_dir: &Path,
) -> u64 {
    let by_id: HashMap<&str, &CaptureCandidate> =
        candidates.iter().map(|c| (c.id.as_str(), c)).collect();
    let mut freed = 0u64;
    for id in ids {
        let Some(item) = by_id.get(id.as_str()) else {
            continue;
        };
        if !item.is_managed {
            continue;
        }
        if !is_under_captures(&item.file_path, captures_dir) {
            continue;
        }
        let path = Path::new(&item.file_path);
        if let Ok(meta) = fs::metadata(path) {
            let size = meta.len();
            if fs::remove_file(path).is_ok() {
                freed = freed.saturating_add(size);
            }
        }
    }
    freed
}

pub fn find_captures_dir(app_local: &Path) -> PathBuf {
    app_local.join("captures")
}

pub fn find_screenshots_dir(app_local: &Path) -> PathBuf {
    app_local.join("screenshots")
}

/// 调试用：解析任意 JSON 元数据字段。
pub fn meta_field(metadata: Option<&str>, key: &str) -> Option<Value> {
    let raw = metadata?;
    let value: Value = serde_json::from_str(raw).ok()?;
    value.get(key).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::time::Duration;

    fn candidate(
        id: &str,
        kind: &str,
        at: i64,
        size: u64,
        keep: bool,
        state: &str,
        managed: bool,
        path: &str,
    ) -> CaptureCandidate {
        CaptureCandidate {
            id: id.to_string(),
            file_path: path.to_string(),
            size,
            captured_at: at,
            capture_kind: kind.to_string(),
            keep,
            state: state.to_string(),
            is_managed: managed,
            source: "capture".to_string(),
        }
    }

    #[test]
    fn prunes_by_days() {
        let now = 1_000_000_000_000i64;
        let items = vec![
            candidate(
                "a",
                "screenshot",
                now,
                10,
                false,
                "done",
                true,
                "/captures/a.png",
            ),
            candidate(
                "b",
                "screenshot",
                now - 10 * 86_400_000,
                10,
                false,
                "done",
                true,
                "/captures/b.png",
            ),
        ];
        let policy = RetentionPolicy {
            kind: "screenshot".into(),
            days: 7,
            count: 100,
            max_bytes: 500 * 1024 * 1024,
        };
        let ids = find_prune_ids(&items, &[policy], now);
        assert!(ids.contains("b"));
        assert!(!ids.contains("a"));
    }

    #[test]
    fn prunes_by_count() {
        let now = 1_000i64;
        let items = vec![
            candidate("a", "screenshot", 300, 1, false, "done", true, "/c/a"),
            candidate("b", "screenshot", 200, 1, false, "done", true, "/c/b"),
            candidate("c", "screenshot", 100, 1, false, "done", true, "/c/c"),
        ];
        let policy = RetentionPolicy {
            kind: "screenshot".into(),
            days: 9999,
            count: 1,
            max_bytes: u64::MAX,
        };
        let ids = find_prune_ids(&items, &[policy], now);
        assert!(!ids.contains("a"));
        assert!(ids.contains("b"));
        assert!(ids.contains("c"));
    }

    #[test]
    fn prunes_by_size() {
        let now = 1_000i64;
        let items = vec![
            candidate("a", "screenshot", 300, 50, false, "done", true, "/c/a"),
            candidate("b", "screenshot", 200, 50, false, "done", true, "/c/b"),
            candidate("c", "screenshot", 100, 50, false, "done", true, "/c/c"),
        ];
        let policy = RetentionPolicy {
            kind: "screenshot".into(),
            days: 9999,
            count: 100,
            max_bytes: 100,
        };
        let ids = find_prune_ids(&items, &[policy], now);
        // a=50 ok, b=100 ok, c=150 > 100 → c doomed
        assert!(!ids.contains("a"));
        assert!(!ids.contains("b"));
        assert!(ids.contains("c"));
    }

    #[test]
    fn keep_skips_prune() {
        let now = 1_000i64;
        let items = vec![candidate(
            "a",
            "screenshot",
            0,
            9999,
            true,
            "done",
            true,
            "/c/a",
        )];
        let policy = RetentionPolicy {
            kind: "screenshot".into(),
            days: 0,
            count: 0,
            max_bytes: 0,
        };
        let ids = find_prune_ids(&items, &[policy], now);
        assert!(ids.is_empty());
    }

    #[test]
    fn recording_state_skips_prune() {
        let now = 1_000i64;
        let items = vec![candidate(
            "a",
            "recording",
            0,
            9999,
            false,
            "recording",
            true,
            "/c/a",
        )];
        let policy = RetentionPolicy {
            kind: "recording".into(),
            days: 0,
            count: 0,
            max_bytes: 0,
        };
        let ids = find_prune_ids(&items, &[policy], now);
        assert!(ids.is_empty());
    }

    #[test]
    fn unmanaged_not_deleted_from_disk() {
        let dir =
            std::env::temp_dir().join(format!("capture-ret-unmanaged-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("ext.mp4");
        File::create(&file).unwrap().write_all(b"hello").unwrap();
        let items = vec![candidate(
            "a",
            "recording",
            0,
            5,
            false,
            "done",
            false,
            file.to_string_lossy().as_ref(),
        )];
        let ids: HashSet<String> = ["a".into()].into_iter().collect();
        let freed = remove_managed_files(&items, &ids, &dir);
        assert_eq!(freed, 0);
        assert!(file.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn orphan_protect_window() {
        let dir = std::env::temp_dir().join(format!("capture-ret-orphan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("orphan.png");
        File::create(&file).unwrap().write_all(b"x").unwrap();
        let referenced = HashSet::new();
        let now = SystemTime::now();
        let freed = prune_orphans(&dir, &referenced, now, Duration::from_secs(600));
        assert_eq!(freed, 0);
        assert!(file.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_candidate_requires_source_capture() {
        assert!(
            parse_candidate("1", "/a.png", Some(1), 1, Some(r#"{"source":"import"}"#)).is_none()
        );
        assert!(
            parse_candidate("1", "/a.png", Some(1), 1, Some(r#"{"source":"capture"}"#)).is_some()
        );
    }
}
