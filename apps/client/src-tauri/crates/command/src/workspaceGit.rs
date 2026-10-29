#![allow(non_snake_case)]
//! 工作区 Git IPC 门面。
//!
//! 读路径（probe / status 缓存 / blob / diff）见 [`crate::git`]；
//! 写路径（stage / commit / …）仍调用系统 git CLI。

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};

use crate::git::{
    self, bump_status, invalidate_status, list_branches, mark_unchanged, open_repo, plan_diff,
    plan_diff_hunks, probe_repo, read_status, run_git, status_backend, status_cached, store_status,
    validate_branch, validate_path, validate_relative_paths, DiffHunksR, DiffMetaR, DiffMode,
    StatusLookup, StatusR,
};

// ─── 请求 / 响应（对前端稳定） ───

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathP {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutP {
    pub path: String,
    pub branch: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeR {
    pub is_repo: bool,
    pub branch: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchesR {
    pub current: String,
    pub branches: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutR {
    pub branch: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathsP {
    pub path: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardP {
    pub path: String,
    pub paths: Vec<String>,
    pub is_untracked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffP {
    pub path: String,
    pub file_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunksP {
    pub path: String,
    pub file_path: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitP {
    pub path: String,
    pub message: String,
    pub is_stage_all: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionR {
    pub summary: String,
}

/// 兼容旧前端：并排时带正文；hunks 模式正文为空，走 diffHunks。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffR {
    pub mode: DiffMode,
    pub original: String,
    pub modified: String,
    pub patch: String,
    pub is_binary: bool,
    pub is_large: bool,
    pub is_identical: bool,
    pub original_lines: u32,
    pub modified_lines: u32,
    pub hunk_count: u32,
    pub added: u32,
    pub deleted: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOut {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<git::StatusEntryR>,
    pub cache_hit: bool,
    pub unchanged: bool,
}

fn to_status_out(status: StatusR) -> StatusOut {
    StatusOut {
        branch: status.branch,
        ahead: status.ahead,
        behind: status.behind,
        entries: status.entries,
        cache_hit: status.cache_hit,
        unchanged: status.unchanged,
    }
}

// ─── 读路径 ───

#[tauri::command(rename = "workspaceGit:probe")]
pub async fn workspaceGitProbe(params: PathP) -> CommandResult<ProbeR> {
    let cwd = validate_path(&params.path)?;
    let info = tokio::task::spawn_blocking(move || probe_repo(&cwd))
        .await
        .map_err(|err| Exception::Internal(format!("probe 任务失败：{err}")))?;
    Ok(ProbeR {
        is_repo: info.is_repo,
        branch: info.branch,
    })
}

#[tauri::command(rename = "workspaceGit:branches")]
pub async fn workspaceGitBranches(params: PathP) -> CommandResult<BranchesR> {
    let cwd = validate_path(&params.path)?;
    let (current, branches) = list_branches(&cwd).await?;
    Ok(BranchesR { current, branches })
}

#[tauri::command(rename = "workspaceGit:status")]
pub async fn workspaceGitStatus(params: PathP) -> CommandResult<StatusOut> {
    let cwd = validate_path(&params.path)?;
    // gix Repository 非 Sync：指纹比对在同步作用域内完成，勿跨 .await 持有 &repo
    let lookup = {
        let repo = open_repo(&cwd).ok();
        status_cached(&cwd, repo.as_ref())
    };
    match lookup {
        StatusLookup::Hit(mut status) => {
            status.cache_hit = true;
            status.unchanged = true;
            return Ok(to_status_out(status));
        }
        StatusLookup::Miss {
            fingerprint,
            previous,
        } => {
            let mut status = read_status(&cwd, status_backend()).await?;
            status.cache_hit = false;
            status.unchanged = mark_unchanged(previous.as_ref(), &status);
            store_status(&cwd, fingerprint, status.clone());
            Ok(to_status_out(status))
        }
    }
}

#[tauri::command(rename = "workspaceGit:invalidate")]
pub async fn workspaceGitInvalidate(params: PathP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    invalidate_status(&cwd);
    Ok(ActionR {
        summary: "已失效 status 缓存".into(),
    })
}

#[tauri::command(rename = "workspaceGit:diff")]
pub async fn workspaceGitDiff(params: DiffP) -> CommandResult<DiffR> {
    let cwd = validate_path(&params.path)?;
    let mut cleaned = validate_relative_paths(&[params.file_path])?;
    let file_path = cleaned.remove(0);
    let plan = plan_diff(&cwd, &file_path).await?;
    Ok(DiffR {
        mode: plan.meta.mode,
        original: plan.original,
        modified: plan.modified,
        patch: String::new(),
        is_binary: plan.meta.is_binary,
        is_large: plan.meta.is_large,
        is_identical: plan.meta.is_identical,
        original_lines: plan.meta.original_lines,
        modified_lines: plan.meta.modified_lines,
        hunk_count: plan.meta.hunk_count,
        added: plan.meta.added,
        deleted: plan.meta.deleted,
    })
}

#[tauri::command(rename = "workspaceGit:diffMeta")]
pub async fn workspaceGitDiffMeta(params: DiffP) -> CommandResult<DiffMetaR> {
    let cwd = validate_path(&params.path)?;
    let mut cleaned = validate_relative_paths(&[params.file_path])?;
    let file_path = cleaned.remove(0);
    let plan = plan_diff(&cwd, &file_path).await?;
    Ok(plan.meta)
}

#[tauri::command(rename = "workspaceGit:diffHunks")]
pub async fn workspaceGitDiffHunks(params: DiffHunksP) -> CommandResult<DiffHunksR> {
    let cwd = validate_path(&params.path)?;
    let mut cleaned = validate_relative_paths(&[params.file_path])?;
    let file_path = cleaned.remove(0);
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(40);
    tokio::task::spawn_blocking(move || plan_diff_hunks(&cwd, &file_path, offset, limit))
        .await
        .map_err(|err| Exception::Internal(format!("diffHunks 任务失败：{err}")))?
}

// ─── 写路径（CLI） ───

#[tauri::command(rename = "workspaceGit:checkout")]
pub async fn workspaceGitCheckout(params: CheckoutP) -> CommandResult<CheckoutR> {
    let cwd = validate_path(&params.path)?;
    let branch = validate_branch(&params.branch)?.to_string();
    let (ok, _, err) = run_git(&cwd, &["checkout", &branch]).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            format!("切换到分支 {branch} 失败")
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(CheckoutR { branch })
}

#[tauri::command(rename = "workspaceGit:stage")]
pub async fn workspaceGitStage(params: PathsP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let paths = validate_relative_paths(&params.paths)?;
    let mut args: Vec<String> = vec!["add".into(), "-A".into(), "--".into()];
    args.extend(paths);
    let (ok, _, err) = git::run_git_args(&cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "暂存失败".into()
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: "已暂存".into(),
    })
}

#[tauri::command(rename = "workspaceGit:unstage")]
pub async fn workspaceGitUnstage(params: PathsP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let paths = validate_relative_paths(&params.paths)?;
    let mut args: Vec<String> = vec!["restore".into(), "--staged".into(), "--".into()];
    args.extend(paths.clone());
    let (ok, _, _) = git::run_git_args(&cwd, &args).await?;
    if !ok {
        let mut fallback: Vec<String> = vec!["reset".into(), "HEAD".into(), "--".into()];
        fallback.extend(paths);
        let (fallback_ok, _, fallback_err) = git::run_git_args(&cwd, &fallback).await?;
        if !fallback_ok {
            return Err(Exception::Internal(if fallback_err.is_empty() {
                "取消暂存失败".into()
            } else {
                fallback_err
            }));
        }
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: "已取消暂存".into(),
    })
}

#[tauri::command(rename = "workspaceGit:discard")]
pub async fn workspaceGitDiscard(params: DiscardP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let paths = validate_relative_paths(&params.paths)?;
    let mut args: Vec<String> = if params.is_untracked.unwrap_or(false) {
        vec!["clean".into(), "-f".into(), "-d".into(), "--".into()]
    } else {
        vec!["restore".into(), "--".into()]
    };
    args.extend(paths);
    let (ok, _, err) = git::run_git_args(&cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "撤销更改失败".into()
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: "已撤销更改".into(),
    })
}

#[tauri::command(rename = "workspaceGit:commit")]
pub async fn workspaceGitCommit(params: CommitP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let message = params.message.trim().to_string();
    if message.is_empty() {
        return Err(Exception::Validation("提交说明不能为空".into()));
    }
    if params.is_stage_all.unwrap_or(false) {
        let (stage_ok, _, stage_err) = run_git(&cwd, &["add", "-A"]).await?;
        if !stage_ok {
            return Err(Exception::Internal(if stage_err.is_empty() {
                "暂存全部更改失败".into()
            } else {
                stage_err
            }));
        }
    }
    let (ok, stdout, err) = run_git(&cwd, &["commit", "-m", &message]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        let hint = if detail.contains("nothing to commit") || detail.contains("no changes added") {
            "没有已暂存的更改".to_string()
        } else if detail.is_empty() {
            "提交失败".to_string()
        } else {
            detail
        };
        return Err(Exception::Internal(hint));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "已提交".into()
        } else {
            stdout
        },
    })
}

#[tauri::command(rename = "workspaceGit:fetch")]
pub async fn workspaceGitFetch(params: PathP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let (ok, stdout, err) = run_git(&cwd, &["fetch", "--all", "--prune"]).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "获取远程更新失败".into()
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "已获取远程更新".into()
        } else {
            stdout
        },
    })
}

#[tauri::command(rename = "workspaceGit:pull")]
pub async fn workspaceGitPull(params: PathP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let (ok, stdout, err) = run_git(&cwd, &["pull", "--ff-only"]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            "拉取失败，请确认本地没有与远端冲突的提交".into()
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "已拉取".into()
        } else {
            stdout
        },
    })
}
