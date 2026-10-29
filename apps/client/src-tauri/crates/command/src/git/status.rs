use std::path::Path;

use cogito_core::{CommandResult, Exception};
use serde::Serialize;

use super::cli::run_git_args;
use super::session::open_repo;
use super::StatusBackend;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntryR {
    pub path: String,
    /// 暂存区状态字符（`git status` 的 X）
    pub index_status: String,
    /// 工作区状态字符（Y）
    pub worktree_status: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusR {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<StatusEntryR>,
    /// 本次是否命中指纹缓存
    pub cache_hit: bool,
    /// 指纹未变时可直接跳过 UI 更新
    pub unchanged: bool,
}

/// 解析 `## main...origin/main [ahead 1, behind 2]`
fn parse_branch_line(line: &str) -> (String, u32, u32) {
    let body = line.trim_start_matches("## ").trim();
    let (name_part, tracking) = match body.split_once(" [") {
        Some((name, rest)) => (name, rest),
        None => (body, ""),
    };
    let branch = name_part
        .split("...")
        .next()
        .unwrap_or(name_part)
        .trim()
        .to_string();
    let mut ahead = 0;
    let mut behind = 0;
    for token in tracking.trim_end_matches(']').split(',') {
        let token = token.trim();
        if let Some(value) = token.strip_prefix("ahead ") {
            ahead = value.trim().parse().unwrap_or(0);
        } else if let Some(value) = token.strip_prefix("behind ") {
            behind = value.trim().parse().unwrap_or(0);
        }
    }
    (branch, ahead, behind)
}

pub async fn read_status_cli(cwd: &Path) -> CommandResult<StatusR> {
    let args: Vec<String> = [
        "status",
        "--porcelain=v1",
        "-z",
        "--branch",
        "--untracked-files=all",
    ]
    .iter()
    .map(|item| (*item).to_string())
    .collect();
    let (ok, stdout, err) = run_git_args(cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "读取 Git 状态失败".into()
        } else {
            err
        }));
    }

    let mut branch = String::new();
    let mut ahead = 0;
    let mut behind = 0;
    let mut entries = Vec::new();
    let mut tokens = stdout.split('\0');
    while let Some(token) = tokens.next() {
        if token.is_empty() {
            continue;
        }
        if let Some(rest) = token.strip_prefix("## ") {
            let parsed = parse_branch_line(&format!("## {rest}"));
            branch = parsed.0;
            ahead = parsed.1;
            behind = parsed.2;
            continue;
        }
        if token.len() < 4 {
            continue;
        }
        let mut chars = token.char_indices();
        let index_status = chars.next().map(|item| item.1).unwrap_or(' ');
        let worktree_status = chars.next().map(|item| item.1).unwrap_or(' ');
        let path = token[3..].to_string();
        if matches!(index_status, 'R' | 'C') {
            tokens.next();
        }
        entries.push(StatusEntryR {
            path,
            index_status: index_status.to_string(),
            worktree_status: worktree_status.to_string(),
        });
    }

    Ok(StatusR {
        branch,
        ahead,
        behind,
        entries,
        cache_hit: false,
        unchanged: false,
    })
}

pub async fn read_status(cwd: &Path, backend: StatusBackend) -> CommandResult<StatusR> {
    // porcelain XY + ahead/behind 与 UI 金样对齐成本高；默认 CLI + 指纹缓存。
    // `COGITO_GIT_STATUS_BACKEND=gix` 预留（当前与 CLI 同源，便于基准切换后扩展）。
    // 注意：勿把 `&gix::Repository` 传入本 async fn（非 Send，无法进 Tauri handler）。
    match backend {
        StatusBackend::Cli | StatusBackend::Gix => read_status_cli(cwd).await,
    }
}

/// 本地分支列表（gix）；失败时回退 CLI。
pub async fn list_branches(cwd: &Path) -> CommandResult<(String, Vec<String>)> {
    let cwd_owned = cwd.to_path_buf();
    match tokio::task::spawn_blocking(move || list_branches_gix(&cwd_owned)).await {
        Ok(Ok(result)) => Ok(result),
        Ok(Err(err)) => {
            eprintln!("[git] list_branches gix 失败，回退 CLI：{err}");
            list_branches_cli(cwd).await
        }
        Err(err) => {
            eprintln!("[git] list_branches 任务失败，回退 CLI：{err}");
            list_branches_cli(cwd).await
        }
    }
}

fn list_branches_gix(cwd: &Path) -> CommandResult<(String, Vec<String>)> {
    let repo = open_repo(cwd)?;
    let current = repo
        .head_name()
        .ok()
        .flatten()
        .map(|name| name.shorten().to_string())
        .unwrap_or_else(|| "HEAD".into());

    let platform = repo
        .references()
        .map_err(|err| Exception::Internal(format!("无法枚举引用：{err}")))?;
    let iter = platform
        .local_branches()
        .map_err(|err| Exception::Internal(format!("无法列出分支：{err}")))?;

    let mut branches = Vec::new();
    for item in iter {
        let reference = item.map_err(|err| Exception::Internal(format!("读取分支失败：{err}")))?;
        let name = reference
            .name()
            .shorten()
            .to_string();
        if !name.is_empty() {
            branches.push(name);
        }
    }
    branches.sort();
    branches.dedup();
    if !branches.iter().any(|item| item == &current) && current != "HEAD" {
        branches.push(current.clone());
        branches.sort();
    }
    Ok((current, branches))
}

async fn list_branches_cli(cwd: &Path) -> CommandResult<(String, Vec<String>)> {
    use super::cli::run_git;
    let current_fut = run_git(cwd, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let list_fut = run_git(cwd, &["branch", "--format=%(refname:short)"]);
    let (current_result, list_result) = tokio::join!(current_fut, list_fut);
    let (cur_ok, current, cur_err) = current_result?;
    if !cur_ok {
        return Err(Exception::Internal(if cur_err.is_empty() {
            "无法读取当前分支".into()
        } else {
            cur_err
        }));
    }
    let (list_ok, listed, list_err) = list_result?;
    if !list_ok {
        return Err(Exception::Internal(if list_err.is_empty() {
            "无法列出分支".into()
        } else {
            list_err
        }));
    }
    let mut branches: Vec<String> = listed
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    branches.sort();
    branches.dedup();
    Ok((current, branches))
}

#[cfg(test)]
mod tests {
    use super::parse_branch_line;

    #[test]
    fn parse_ahead_behind() {
        let (branch, ahead, behind) =
            parse_branch_line("## main...origin/main [ahead 2, behind 1]");
        assert_eq!(branch, "main");
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
    }

    #[test]
    fn parse_detached_style() {
        let (branch, ahead, behind) = parse_branch_line("## feature/x");
        assert_eq!(branch, "feature/x");
        assert_eq!(ahead, 0);
        assert_eq!(behind, 0);
    }
}
