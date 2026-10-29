use std::path::{Path, PathBuf};

use cogito_core::{CommandResult, Exception};
use serde::Serialize;
use similar::{Algorithm, ChangeTag, TextDiff};

use super::blob::{
    looks_binary, prepare_side, read_head_bytes, read_worktree_bytes, worktree_fingerprint,
};
use super::cli::run_git_args;
use super::session::open_repo;

/// 两侧合计超过此字节数 → hunks，避免 Monaco LCS。
pub const LARGE_DIFF_BYTES: usize = 80_000;
/// 行变更量（粗估）≥ 此值 → hunks。
pub const LARGE_CHANGE_LINES: u32 = 2_000;

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DiffMode {
    SideBySide,
    Hunks,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffMetaR {
    pub mode: DiffMode,
    pub is_binary: bool,
    pub is_large: bool,
    pub is_identical: bool,
    pub original_lines: u32,
    pub modified_lines: u32,
    pub hunk_count: u32,
    pub added: u32,
    pub deleted: u32,
    pub file_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunksR {
    pub hunks: Vec<DiffHunk>,
    pub total: u32,
    pub offset: u32,
}

#[derive(Debug)]
pub struct DiffPlan {
    pub meta: DiffMetaR,
    pub original: String,
    pub modified: String,
}

/// 解析 `git diff --numstat` 单行。
fn parse_numstat_line(line: &str) -> Option<(u32, u32, bool)> {
    let mut parts = line.splitn(3, '\t');
    let added_raw = parts.next()?;
    let deleted_raw = parts.next()?;
    let _path = parts.next()?;
    if added_raw == "-" || deleted_raw == "-" {
        return Some((0, 0, true));
    }
    let added = added_raw.parse::<u32>().ok()?;
    let deleted = deleted_raw.parse::<u32>().ok()?;
    Some((added, deleted, false))
}

async fn numstat_changes(cwd: &Path, relative: &str) -> (u32, u32, bool) {
    let args = vec![
        "diff".into(),
        "--numstat".into(),
        "HEAD".into(),
        "--".into(),
        relative.to_string(),
    ];
    let Ok((_ok, out, _)) = run_git_args(cwd, &args).await else {
        return (0, 0, false);
    };
    out.lines()
        .find_map(|line| parse_numstat_line(line.trim()))
        .unwrap_or((0, 0, false))
}

fn build_hunks(original: &str, modified: &str) -> (Vec<DiffHunk>, u32, u32) {
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(original, modified);

    let mut hunks = Vec::new();
    let mut added = 0_u32;
    let mut deleted = 0_u32;

    for group in diff.grouped_ops(3) {
        if group.is_empty() {
            continue;
        }
        let first = &group[0];
        let last = group.last().unwrap();
        let old_start = first.old_range().start as u32 + 1;
        let new_start = first.new_range().start as u32 + 1;
        let old_end = last.old_range().end as u32;
        let new_end = last.new_range().end as u32;
        let old_lines = old_end.saturating_sub(first.old_range().start as u32);
        let new_lines = new_end.saturating_sub(first.new_range().start as u32);

        let mut lines = Vec::new();
        for op in &group {
            for change in diff.iter_changes(op) {
                let tag = match change.tag() {
                    ChangeTag::Delete => {
                        deleted = deleted.saturating_add(1);
                        '-'
                    }
                    ChangeTag::Insert => {
                        added = added.saturating_add(1);
                        '+'
                    }
                    ChangeTag::Equal => ' ',
                };
                let value = change.value();
                let mut row = String::with_capacity(value.len() + 1);
                row.push(tag);
                row.push_str(value.trim_end_matches('\n'));
                lines.push(row);
            }
        }

        let header = format!("@@ -{old_start},{old_lines} +{new_start},{new_lines} @@");
        hunks.push(DiffHunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            header,
            lines,
        });
    }

    (hunks, added, deleted)
}

/// 规划差异：短路 → 选 mode；sideBySide 才带正文。
///
/// gix `Repository` 含 RefCell，`&Repository` 非 Send；numstat 之后在 blocking 线程打开仓库。
pub async fn plan_diff(cwd: &Path, relative: &str) -> CommandResult<DiffPlan> {
    let relative = relative.replace('\\', "/");
    let (ns_added, ns_deleted, ns_binary) = numstat_changes(cwd, &relative).await;

    if ns_binary {
        return Ok(DiffPlan {
            meta: DiffMetaR {
                mode: DiffMode::SideBySide,
                is_binary: true,
                is_large: false,
                is_identical: false,
                original_lines: 0,
                modified_lines: 0,
                hunk_count: 0,
                added: 0,
                deleted: 0,
                file_bytes: 0,
            },
            original: String::new(),
            modified: String::new(),
        });
    }

    let cwd_owned: PathBuf = cwd.to_path_buf();
    let relative_owned = relative;
    tokio::task::spawn_blocking(move || {
        plan_diff_blocking(&cwd_owned, &relative_owned, ns_added, ns_deleted)
    })
    .await
    .map_err(|err| Exception::Internal(format!("diff 任务失败：{err}")))?
}

fn plan_diff_blocking(
    cwd: &Path,
    relative: &str,
    ns_added: u32,
    ns_deleted: u32,
) -> CommandResult<DiffPlan> {
    let ns_changes = ns_added.saturating_add(ns_deleted);
    let force_hunks = ns_changes >= LARGE_CHANGE_LINES;
    let repo = open_repo(cwd)?;

    let head_bytes = read_head_bytes(&repo, relative)?;
    let work_bytes = read_worktree_bytes(cwd, relative);
    let file_bytes = (head_bytes.len() + work_bytes.len()) as u64;

    if looks_binary(&head_bytes) || looks_binary(&work_bytes) {
        return Ok(DiffPlan {
            meta: DiffMetaR {
                mode: DiffMode::SideBySide,
                is_binary: true,
                is_large: false,
                is_identical: false,
                original_lines: 0,
                modified_lines: 0,
                hunk_count: 0,
                added: 0,
                deleted: 0,
                file_bytes,
            },
            original: String::new(),
            modified: String::new(),
        });
    }

    let (original, original_lines) = prepare_side(head_bytes);
    let (modified, modified_lines) = prepare_side(work_bytes);

    if original == modified {
        return Ok(DiffPlan {
            meta: DiffMetaR {
                mode: DiffMode::SideBySide,
                is_binary: false,
                is_large: false,
                is_identical: true,
                original_lines,
                modified_lines,
                hunk_count: 0,
                added: 0,
                deleted: 0,
                file_bytes,
            },
            original: String::new(),
            modified: String::new(),
        });
    }

    let total_bytes = original.len() + modified.len();
    let total_lines = original_lines.saturating_add(modified_lines);
    let is_large =
        force_hunks || total_bytes >= LARGE_DIFF_BYTES || total_lines >= LARGE_CHANGE_LINES;

    if is_large {
        return Ok(DiffPlan {
            meta: DiffMetaR {
                mode: DiffMode::Hunks,
                is_binary: false,
                is_large: true,
                is_identical: false,
                original_lines,
                modified_lines,
                hunk_count: 0,
                added: ns_added,
                deleted: ns_deleted,
                file_bytes,
            },
            original: String::new(),
            modified: String::new(),
        });
    }

    Ok(DiffPlan {
        meta: DiffMetaR {
            mode: DiffMode::SideBySide,
            is_binary: false,
            is_large: false,
            is_identical: false,
            original_lines,
            modified_lines,
            hunk_count: 0,
            added: ns_added,
            deleted: ns_deleted,
            file_bytes,
        },
        original,
        modified,
    })
}

/// 计算并分页返回 hunks（在 blocking 线程调用；内部自行 open_repo）。
pub fn plan_diff_hunks(
    cwd: &Path,
    relative: &str,
    offset: u32,
    limit: u32,
) -> CommandResult<DiffHunksR> {
    let relative = relative.replace('\\', "/");
    let _ = worktree_fingerprint(cwd, &relative);
    let repo = open_repo(cwd)?;

    let head_bytes = read_head_bytes(&repo, &relative)?;
    let work_bytes = read_worktree_bytes(cwd, &relative);
    if looks_binary(&head_bytes) || looks_binary(&work_bytes) {
        return Ok(DiffHunksR {
            hunks: Vec::new(),
            total: 0,
            offset,
        });
    }
    let (original, _) = prepare_side(head_bytes);
    let (modified, _) = prepare_side(work_bytes);
    let (all, _, _) = build_hunks(&original, &modified);
    let total = all.len() as u32;
    let start = offset as usize;
    let end = if limit == 0 {
        all.len()
    } else {
        (start + limit as usize).min(all.len())
    };
    let hunks = if start >= all.len() {
        Vec::new()
    } else {
        all[start..end].to_vec()
    };
    Ok(DiffHunksR {
        hunks,
        total,
        offset,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_texts_produce_no_hunks() {
        let (hunks, added, deleted) = build_hunks("a\nb\n", "a\nb\n");
        assert!(hunks.is_empty());
        assert_eq!(added, 0);
        assert_eq!(deleted, 0);
    }

    #[test]
    fn simple_change_produces_hunk() {
        let (hunks, added, deleted) = build_hunks("a\n", "b\n");
        assert_eq!(hunks.len(), 1);
        assert_eq!(added, 1);
        assert_eq!(deleted, 1);
        assert!(hunks[0].lines.iter().any(|l| l.starts_with('-')));
        assert!(hunks[0].lines.iter().any(|l| l.starts_with('+')));
    }
}
