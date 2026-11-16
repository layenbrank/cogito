//! `git worktree` 读 + 写路径。
//!
//! 列表读 `--porcelain`（字段稳定、不含对齐空格，空行分段）；增删仍走系统 git CLI。
//! 新建 / 删除的**目标路径**可能还不存在（新建）或已失效（删除），所以不能复用
//! `validate_path`（它要求目录已存在），这里单独校验。

use std::path::{Component, Path, PathBuf};

use cogito_core::{CommandResult, Exception};
use serde::Serialize;

use super::cli::run_git_args;
use super::path::{strip_windows_verbatim_prefix, validate_branch};

/// `git worktree list --porcelain` 的一条
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeR {
    /// 工作树根（git 记录的形态，Windows 上可能是正斜杠）
    pub path: String,
    /// 该工作树 HEAD 的 oid；裸仓库里可能为空串
    pub head: String,
    /// 短分支名（`refs/heads/` 已剥）；游离 HEAD 为 None
    pub branch: Option<String>,
    pub is_bare: bool,
    pub is_detached: bool,
    pub is_locked: bool,
    pub is_prunable: bool,
    /// 主工作树（porcelain 输出的第一段）
    pub is_main: bool,
}

fn push_current(list: &mut Vec<WorktreeR>, current: &mut Option<WorktreeR>) {
    if let Some(item) = current.take() {
        list.push(item);
    }
}

/// 解析 `--porcelain`：属性行 `key value` 或裸 `key`，空行分隔工作树。
fn parse_porcelain(raw: &str) -> Vec<WorktreeR> {
    let mut list: Vec<WorktreeR> = Vec::new();
    let mut current: Option<WorktreeR> = None;

    for line in raw.lines() {
        if line.trim().is_empty() {
            push_current(&mut list, &mut current);
            continue;
        }
        let (key, value) = match line.split_once(' ') {
            Some((key, value)) => (key, value),
            None => (line, ""),
        };
        let entry = current.get_or_insert_with(|| WorktreeR {
            path: String::new(),
            head: String::new(),
            branch: None,
            is_bare: false,
            is_detached: false,
            is_locked: false,
            is_prunable: false,
            is_main: false,
        });
        match key {
            "worktree" => entry.path = value.trim().to_string(),
            "HEAD" => entry.head = value.trim().to_string(),
            "branch" => {
                entry.branch =
                    Some(value.strip_prefix("refs/heads/").unwrap_or(value).to_string());
            }
            "bare" => entry.is_bare = true,
            "detached" => entry.is_detached = true,
            "locked" => entry.is_locked = true,
            "prunable" => entry.is_prunable = true,
            _ => {}
        }
    }
    push_current(&mut list, &mut current);
    list.retain(|item| !item.path.is_empty());
    if let Some(first) = list.first_mut() {
        first.is_main = true;
    }
    list
}

/// 新建 / 删除工作树的目标路径：可能尚未存在，只做「绝对 + 无 `..`」校验。
pub fn validate_worktree_target(raw: &str) -> CommandResult<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("工作树路径不能为空".into()));
    }
    let path = strip_windows_verbatim_prefix(PathBuf::from(trimmed));
    if !path.is_absolute() {
        return Err(Exception::Validation("工作树路径必须为绝对路径".into()));
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(Exception::Validation("工作树路径非法".into()));
    }
    Ok(path)
}

pub async fn list_worktrees(cwd: &Path) -> CommandResult<Vec<WorktreeR>> {
    let args: Vec<String> = vec!["worktree".into(), "list".into(), "--porcelain".into()];
    let (ok, stdout, stderr) = run_git_args(cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if stderr.trim().is_empty() {
            "读取工作树列表失败".into()
        } else {
            stderr
        }));
    }
    Ok(parse_porcelain(&stdout))
}

/// `git worktree add [-b <branch>] <target> [<branch>]`
///
/// - `is_new_branch = true` + `branch`：建分支并检出到新工作树
/// - `is_new_branch = false` + `branch`：把已有分支检出到新工作树
/// - 不给 `branch`：交给 git 按目录名自建分支
pub async fn add_worktree(
    cwd: &Path,
    target: &Path,
    branch: Option<&str>,
    is_new_branch: bool,
) -> CommandResult<String> {
    let name = branch.map(str::trim).filter(|value| !value.is_empty());
    let mut args: Vec<String> = vec!["worktree".into(), "add".into()];

    if let Some(name) = name {
        let name = validate_branch(name)?.to_string();
        if is_new_branch {
            args.push("-b".into());
            args.push(name);
        }
    }
    args.push(target.to_string_lossy().into_owned());
    if let Some(name) = name {
        if !is_new_branch {
            args.push(validate_branch(name)?.to_string());
        }
    }

    let (ok, stdout, stderr) = run_git_args(cwd, &args).await?;
    if !ok {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(Exception::Internal(if detail.trim().is_empty() {
            "新建工作树失败".into()
        } else {
            detail
        }));
    }
    Ok(if stdout.trim().is_empty() {
        format!("已新建工作树 {}", target.display())
    } else {
        stdout
    })
}

pub async fn remove_worktree(cwd: &Path, target: &Path, is_force: bool) -> CommandResult<String> {
    let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
    if is_force {
        args.push("--force".into());
    }
    args.push(target.to_string_lossy().into_owned());

    let (ok, stdout, stderr) = run_git_args(cwd, &args).await?;
    if !ok {
        let detail = if stderr.trim().is_empty() {
            stdout
        } else {
            stderr
        };
        return Err(Exception::Internal(if detail.trim().is_empty() {
            "删除工作树失败".into()
        } else {
            detail
        }));
    }
    Ok(format!("已删除工作树 {}", target.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_blocks() {
        let raw = "\
worktree D:/repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree D:/repo-feature
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/x
locked 占用中

worktree D:/repo-detached
HEAD 3333333333333333333333333333333333333333
detached
";
        let list = parse_porcelain(raw);
        assert_eq!(list.len(), 3);
        assert!(list[0].is_main);
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert_eq!(list[1].branch.as_deref(), Some("feat/x"));
        assert!(list[1].is_locked);
        assert!(list[2].is_detached);
        assert_eq!(list[2].branch, None);
        assert!(!list[2].is_main);
    }

    #[test]
    fn rejects_relative_or_escaping_target() {
        assert!(validate_worktree_target("").is_err());
        assert!(validate_worktree_target("repo-feature").is_err());
        assert!(validate_worktree_target("D:/repo/../escape").is_err());
        assert!(validate_worktree_target("D:/repo-feature").is_ok());
    }
}
