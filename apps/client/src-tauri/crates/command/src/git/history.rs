//! 提交检索与单提交变更列表（只读）。
//!
//! 搜索走系统 `git log`（grep/author/hash 前缀成熟且快）；
//! 展示走 `git diff-tree`；正文对比仍由 gix blob + diff 模块处理。

use std::path::Path;

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};

use super::cli::run_git_args;

/// 单次 walk 硬上限，避免超大仓卡死。
const MAX_SCAN: usize = 5_000;
const DEFAULT_LIMIT: u32 = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchField {
    All,
    Message,
    Author,
    Hash,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitHit {
    pub oid: String,
    pub short: String,
    pub subject: String,
    pub author_name: String,
    pub committed_at: i64,
    pub parent_oid: Option<String>,
    pub is_head: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchR {
    pub commits: Vec<CommitHit>,
    pub has_more: bool,
    /// 本次实际扫描的提交数（含未命中），供前端提示上限。
    pub scanned: u32,
    pub hit_scan_cap: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShowFile {
    pub path: String,
    /// `A` / `M` / `D` / `R` / `C` / `T` 等 name-status 状态。
    pub status: String,
    pub added: Option<u32>,
    pub deleted: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowR {
    pub oid: String,
    pub parent_oid: Option<String>,
    pub files: Vec<ShowFile>,
}

fn is_hex_prefix(query: &str) -> bool {
    let trimmed = query.trim();
    if trimmed.len() < 4 || trimmed.len() > 40 {
        return false;
    }
    trimmed.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_record(line: &str, head_oid: &str) -> Option<CommitHit> {
    let mut parts = line.split('\x01');
    let oid = parts.next()?.trim().to_string();
    if oid.is_empty() {
        return None;
    }
    let short = parts.next()?.trim().to_string();
    let subject = parts.next()?.trim().to_string();
    let author_name = parts.next()?.trim().to_string();
    let committed_at = parts.next()?.trim().parse::<i64>().unwrap_or(0);
    let parents = parts.next().unwrap_or("").trim();
    let parent_oid = parents
        .split_whitespace()
        .next()
        .filter(|item| !item.is_empty())
        .map(str::to_string);
    Some(CommitHit {
        is_head: oid == head_oid,
        oid,
        short,
        subject,
        author_name,
        committed_at,
        parent_oid,
    })
}

fn matches_hit(hit: &CommitHit, query: &str, field: SearchField) -> bool {
    let needle = query.trim();
    if needle.is_empty() {
        return true;
    }
    let lower = needle.to_ascii_lowercase();
    match field {
        SearchField::Hash => hit.oid.to_ascii_lowercase().starts_with(&lower),
        SearchField::Message => hit.subject.to_ascii_lowercase().contains(&lower),
        SearchField::Author => hit.author_name.to_ascii_lowercase().contains(&lower),
        SearchField::All => {
            if is_hex_prefix(needle) && hit.oid.to_ascii_lowercase().starts_with(&lower) {
                return true;
            }
            hit.subject.to_ascii_lowercase().contains(&lower)
                || hit.author_name.to_ascii_lowercase().contains(&lower)
                || hit.oid.to_ascii_lowercase().starts_with(&lower)
        }
    }
}

/// 检索提交：空 query 返回最近提交；否则按 field 过滤。
pub async fn search_commits(
    cwd: &Path,
    query: &str,
    field: SearchField,
    limit: u32,
    cursor: Option<&str>,
) -> CommandResult<SearchR> {
    let limit = if limit == 0 { DEFAULT_LIMIT } else { limit.min(200) };
    let mut args = vec![
        "-c".into(),
        "log.showSignature=false".into(),
        "log".into(),
        "--all".into(),
        "--date-order".into(),
        format!("--max-count={MAX_SCAN}"),
        "--format=%H%x01%h%x01%s%x01%an%x01%at%x01%P".into(),
    ];

    // git 原生加速：message / author 用内置过滤，再二次校验
    let trimmed = query.trim();
    if !trimmed.is_empty() {
        match field {
            SearchField::Message => {
                args.push(format!("--grep={trimmed}"));
                args.push("--regexp-ignore-case".into());
            }
            SearchField::Author => {
                args.push(format!("--author={trimmed}"));
                args.push("--regexp-ignore-case".into());
            }
            SearchField::Hash | SearchField::All => {}
        }
    }

    let (ok, out, err) = run_git_args(cwd, &args).await?;
    if !ok && out.is_empty() {
        // 空仓常见：fatal: your current branch ... does not have any commits
        if err.contains("does not have any commits") || err.contains("bad default revision") {
            return Ok(SearchR {
                commits: Vec::new(),
                has_more: false,
                scanned: 0,
                hit_scan_cap: false,
            });
        }
        return Err(Exception::Internal(if err.is_empty() {
            "搜索提交失败".into()
        } else {
            err
        }));
    }

    let head_oid = resolve_head_oid(cwd).await.unwrap_or_default();
    let cursor_oid = cursor.map(str::trim).filter(|item| !item.is_empty()).unwrap_or("");
    let mut past_cursor = cursor_oid.is_empty();

    let mut commits = Vec::new();
    let mut scanned = 0_u32;
    let mut has_more = false;
    let mut hit_scan_cap = false;

    for line in out.lines() {
        scanned = scanned.saturating_add(1);
        if scanned as usize >= MAX_SCAN {
            hit_scan_cap = true;
        }
        let Some(hit) = parse_record(line, &head_oid) else {
            continue;
        };
        if !past_cursor {
            if hit.oid == cursor_oid {
                past_cursor = true;
            }
            continue;
        }
        if !matches_hit(&hit, trimmed, field) {
            continue;
        }
        if commits.len() as u32 >= limit {
            has_more = true;
            break;
        }
        commits.push(hit);
    }

    if hit_scan_cap && !has_more && commits.len() as u32 >= limit {
        has_more = true;
    }

    Ok(SearchR {
        commits,
        has_more,
        scanned,
        hit_scan_cap,
    })
}

async fn resolve_head_oid(cwd: &Path) -> CommandResult<String> {
    let (ok, out, _) = run_git_args(cwd, &["rev-parse".into(), "HEAD".into()]).await?;
    if !ok {
        return Ok(String::new());
    }
    Ok(out.trim().to_string())
}

/// 列出提交相对第一父（或空树）的路径变更。
pub async fn show_commit(cwd: &Path, oid: &str) -> CommandResult<ShowR> {
    let oid = oid.trim();
    if oid.is_empty() || !oid.bytes().all(|byte| byte.is_ascii_hexdigit()) || oid.len() < 4 {
        return Err(Exception::Validation("无效的提交哈希".into()));
    }

    let parent_oid = {
        let (ok, out, _) =
            run_git_args(cwd, &["rev-parse".into(), format!("{oid}^")]).await?;
        if ok {
            let parent = out.trim().to_string();
            if parent.is_empty() {
                None
            } else {
                Some(parent)
            }
        } else {
            None
        }
    };

    let mut name_args = vec![
        "diff-tree".into(),
        "--no-commit-id".into(),
        "--name-status".into(),
        "-r".into(),
        "-z".into(),
    ];
    if let Some(ref parent) = parent_oid {
        name_args.push(parent.clone());
        name_args.push(oid.to_string());
    } else {
        // 根提交：相对空树
        name_args.push("--root".into());
        name_args.push(oid.to_string());
    }

    let (ok, name_out, err) = run_git_args(cwd, &name_args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "读取提交变更失败".into()
        } else {
            err
        }));
    }

    let mut files = parse_name_status_z(&name_out);

    // 可选 +/-：失败则忽略
    let mut num_args = vec![
        "diff-tree".into(),
        "--no-commit-id".into(),
        "--numstat".into(),
        "-r".into(),
    ];
    if let Some(ref parent) = parent_oid {
        num_args.push(parent.clone());
        num_args.push(oid.to_string());
    } else {
        num_args.push("--root".into());
        num_args.push(oid.to_string());
    }
    if let Ok((true, num_out, _)) = run_git_args(cwd, &num_args).await {
        apply_numstat(&mut files, &num_out);
    }

    Ok(ShowR {
        oid: oid.to_string(),
        parent_oid,
        files,
    })
}

fn parse_name_status_z(raw: &str) -> Vec<ShowFile> {
    // -z：status\0path\0 或 R100\0old\0new\0
    let parts: Vec<&str> = raw.split('\0').filter(|part| !part.is_empty()).collect();
    let mut files = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let status_raw = parts[index];
        index += 1;
        if status_raw.is_empty() {
            continue;
        }
        let status_char = status_raw.chars().next().unwrap_or('M');
        let status = status_char.to_string();
        if matches!(status_char, 'R' | 'C') {
            let _old = parts.get(index).copied().unwrap_or("");
            index += 1;
            let new_path = parts.get(index).copied().unwrap_or("").replace('\\', "/");
            index += 1;
            if !new_path.is_empty() {
                files.push(ShowFile {
                    path: new_path,
                    status,
                    added: None,
                    deleted: None,
                });
            }
        } else {
            let path = parts
                .get(index)
                .copied()
                .unwrap_or("")
                .replace('\\', "/");
            index += 1;
            if !path.is_empty() {
                files.push(ShowFile {
                    path,
                    status,
                    added: None,
                    deleted: None,
                });
            }
        }
    }
    files
}

fn apply_numstat(files: &mut [ShowFile], raw: &str) {
    use std::collections::HashMap;
    let mut map: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();
    for line in raw.lines() {
        let mut parts = line.splitn(3, '\t');
        let added_raw = parts.next().unwrap_or("-");
        let deleted_raw = parts.next().unwrap_or("-");
        let path_raw = parts.next().unwrap_or("").replace('\\', "/");
        if path_raw.is_empty() {
            continue;
        }
        // rename：`old => new` 或带 tab 的旧式；取最后一段路径
        let path = if let Some((_, right)) = path_raw.split_once(" => ") {
            right.to_string()
        } else {
            path_raw
        };
        let added = if added_raw == "-" {
            None
        } else {
            added_raw.parse::<u32>().ok()
        };
        let deleted = if deleted_raw == "-" {
            None
        } else {
            deleted_raw.parse::<u32>().ok()
        };
        map.insert(path, (added, deleted));
    }
    for file in files.iter_mut() {
        if let Some((added, deleted)) = map.get(&file.path) {
            file.added = *added;
            file.deleted = *deleted;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn hex_prefix_detection() {
        assert!(is_hex_prefix("abc1"));
        assert!(is_hex_prefix("9a7c85ac314d"));
        assert!(!is_hex_prefix("ab"));
        assert!(!is_hex_prefix("feat"));
    }

    #[test]
    fn match_message_case_insensitive() {
        let hit = CommitHit {
            oid: "abc".into(),
            short: "abc".into(),
            subject: "Fix(Client): Lint".into(),
            author_name: "Layen".into(),
            committed_at: 0,
            parent_oid: None,
            is_head: false,
        };
        assert!(matches_hit(&hit, "lint", SearchField::Message));
        assert!(matches_hit(&hit, "layen", SearchField::Author));
        assert!(matches_hit(&hit, "abc", SearchField::Hash));
    }

    fn workspace_root() -> Option<PathBuf> {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // command → crates → src-tauri → client → apps → workspace-cogito
        let root = manifest
            .join("../../../../../")
            .canonicalize()
            .ok()?;
        if root.join(".git").exists() || root.join(".git").is_file() {
            Some(root)
        } else {
            None
        }
    }

    #[tokio::test]
    async fn search_and_show_against_workspace() {
        let Some(root) = workspace_root() else {
            return;
        };
        let recent = search_commits(&root, "", SearchField::All, 5, None)
            .await
            .expect("search recent");
        assert!(!recent.commits.is_empty(), "expected recent commits");

        let head = &recent.commits[0];
        let by_hash = search_commits(&root, &head.short, SearchField::Hash, 5, None)
            .await
            .expect("search hash");
        assert!(
            by_hash.commits.iter().any(|hit| hit.oid == head.oid),
            "hash search should hit HEAD"
        );

        if !head.author_name.is_empty() {
            let by_author =
                search_commits(&root, &head.author_name, SearchField::Author, 5, None)
                    .await
                    .expect("search author");
            assert!(
                !by_author.commits.is_empty(),
                "author search should return hits"
            );
        }

        let shown = show_commit(&root, &head.oid).await.expect("show");
        assert_eq!(shown.oid, head.oid);
        // HEAD 通常有文件变更；允许空（空提交极少见）
        let _ = shown.files;
    }
}
