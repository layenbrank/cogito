#![allow(non_snake_case)]
//! 工作区 Git IPC 门面。
//!
//! 读路径（probe / status 缓存 / blob / diff）见 [`crate::git`]；
//! 写路径（stage / commit / …）仍调用系统 git CLI。

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};

use crate::git::{
    self, bump_status, invalidate_status, list_branches, mark_unchanged, open_repo, plan_diff,
    plan_diff_hunks, probe_repo, read_status, read_upstream, run_git, search_commits, show_commit, status_backend,
    status_cached, store_status, validate_branch, validate_path, validate_relative_paths,
    DiffHunksR, DiffMetaR, DiffMode, DiffRevs, DiffScope, SearchField, SearchR, ShowR, StatusLookup, StatusR, UpstreamR,
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
    /// 从远端分支切出：此刻 `branch` 是本地分支名，这里给 `origin/feat` 全名
    pub from_remote: Option<String>,
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
    /// `origin/feat` 这类远端分支（不含 `origin/HEAD`）
    pub remotes: Vec<String>,
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
    /// 父提交 / 左侧 oid；与 `new_oid` 同时缺省 = HEAD↔工作区
    pub old_oid: Option<String>,
    /// 目标提交 / 右侧 oid
    pub new_oid: Option<String>,
    /// 差异作用域：缺省 = HEAD↔工作区
    pub side: Option<DiffScope>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunksP {
    pub path: String,
    pub file_path: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
    pub old_oid: Option<String>,
    /// 目标提交 / 右侧 oid
    pub new_oid: Option<String>,
    /// 差异作用域：缺省 = HEAD↔工作区
    pub side: Option<DiffScope>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchP {
    pub path: String,
    pub query: Option<String>,
    pub field: Option<SearchField>,
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowP {
    pub path: String,
    pub oid: String,
}

fn parse_diff_revs(
    old_oid: Option<String>,
    new_oid: Option<String>,
    side: Option<DiffScope>,
) -> DiffRevs {
    let clean = |value: Option<String>| -> Option<String> {
        value.and_then(|item| {
            let trimmed = item.trim().to_string();
            if trimmed.is_empty() {
                // 空串表示空树侧（根提交父）
                Some(String::new())
            } else if trimmed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                Some(trimmed)
            } else {
                None
            }
        })
    };
    let old = clean(old_oid);
    let new = clean(new_oid);
    // 仅当两侧都未传时走工作区模式；任一侧显式传入（含空串）即提交对比
    match (&old, &new) {
        (None, None) => DiffRevs {
            scope: side.unwrap_or_default(),
            ..DiffRevs::default()
        },
        _ => DiffRevs {
            old_oid: old,
            new_oid: new,
            scope: side.unwrap_or_default(),
        },
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushP {
    pub path: String,
    pub branch: String,
    /// 当前分支还没有上游时，用 `git push --set-upstream origin <branch>` 发布
    pub is_set_upstream: Option<bool>,
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
    let listed = list_branches(&cwd).await?;
    Ok(BranchesR {
        current: listed.current,
        branches: listed.branches,
        remotes: listed.remotes,
    })
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
    let revs = parse_diff_revs(params.old_oid, params.new_oid, params.side);
    let plan = plan_diff(&cwd, &file_path, revs).await?;
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
    let revs = parse_diff_revs(params.old_oid, params.new_oid, params.side);
    let plan = plan_diff(&cwd, &file_path, revs).await?;
    Ok(plan.meta)
}

#[tauri::command(rename = "workspaceGit:diffHunks")]
pub async fn workspaceGitDiffHunks(params: DiffHunksP) -> CommandResult<DiffHunksR> {
    let cwd = validate_path(&params.path)?;
    let mut cleaned = validate_relative_paths(&[params.file_path])?;
    let file_path = cleaned.remove(0);
    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(40);
    let revs = parse_diff_revs(params.old_oid, params.new_oid, params.side);
    tokio::task::spawn_blocking(move || plan_diff_hunks(&cwd, &file_path, offset, limit, &revs))
        .await
        .map_err(|err| Exception::Internal(format!("diffHunks 任务失败：{err}")))?
}

#[tauri::command(rename = "workspaceGit:search")]
pub async fn workspaceGitSearch(params: SearchP) -> CommandResult<SearchR> {
    let cwd = validate_path(&params.path)?;
    let query = params.query.unwrap_or_default();
    let field = params.field.unwrap_or(SearchField::All);
    let limit = params.limit.unwrap_or(50);
    let cursor = params.cursor.filter(|item| !item.trim().is_empty());
    search_commits(
        &cwd,
        &query,
        field,
        limit,
        cursor.as_deref(),
    )
    .await
}

#[tauri::command(rename = "workspaceGit:show")]
pub async fn workspaceGitShow(params: ShowP) -> CommandResult<ShowR> {
    let cwd = validate_path(&params.path)?;
    show_commit(&cwd, &params.oid).await
}

// ─── 写路径（CLI） ───

#[tauri::command(rename = "workspaceGit:upstream")]
pub async fn workspaceGitUpstream(params: PathP) -> CommandResult<UpstreamR> {
    let cwd = validate_path(&params.path)?;
    read_upstream(&cwd).await
}

#[tauri::command(rename = "workspaceGit:checkout")]
pub async fn workspaceGitCheckout(params: CheckoutP) -> CommandResult<CheckoutR> {
    let cwd = validate_path(&params.path)?;
    let branch = validate_branch(&params.branch)?.to_string();
    let remote = match params.from_remote.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(validate_branch(raw)?.to_string()),
        _ => None,
    };
    // 本地已有同名分支（或调用方没给远端）时直接切换：失败原因原样上报，
    // 不要被下面「建跟踪分支」的兜底错误盖掉（脏工作区、未完成的合并等）。
    let local_exists = matches!(
        run_git(
            &cwd,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}")
            ]
        )
        .await,
        Ok((true, _, _))
    );
    let (ok, _, err) = if local_exists || remote.is_none() {
        run_git(&cwd, &["checkout", &branch]).await?
    } else {
        (false, String::new(), String::new())
    };
    if !ok {
        let Some(remote_ref) = remote.filter(|_| !local_exists) else {
            return Err(Exception::Internal(if err.is_empty() {
                format!("切换到分支 {branch} 失败")
            } else {
                err
            }));
        };
        // 本地没有同名分支：建一个跟踪远端的分支
        // （唯一远端同名时上面那句 git 已经自动建好，这里只在失败时兜底）
        let (tracked_ok, _, tracked_err) =
            run_git(&cwd, &["checkout", "-b", &branch, "--track", &remote_ref]).await?;
        if !tracked_ok {
            let detail = if tracked_err.is_empty() { err } else { tracked_err };
            return Err(Exception::Internal(if detail.is_empty() {
                format!("切换到分支 {branch} 失败")
            } else {
                detail
            }));
        }
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

#[tauri::command(rename = "workspaceGit:push")]
pub async fn workspaceGitPush(params: PushP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let branch = validate_branch(&params.branch)?.to_string();
    let args: Vec<&str> = if params.is_set_upstream.unwrap_or(false) {
        vec!["push", "--set-upstream", "origin", branch.as_str()]
    } else {
        vec!["push"]
    };
    let (ok, stdout, err) = run_git(&cwd, &args).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            "推送失败".into()
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    // git push 把进度写在 stderr，摘要两边都要
    let summary = [stdout.as_str(), err.as_str()]
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(ActionR {
        summary: if summary.is_empty() {
            "已推送".into()
        } else {
            summary
        },
    })
}

// ─── 变基 / 储藏（工作区状态 + 写路径） ───

/// 一条储藏记录；`index` 是 `stash@{n}` 里的 n（0 = 最新）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashR {
    pub index: u32,
    pub selector: String,
    /// 去掉 git 自动加的前缀后的人类可读说明（`On main: 修 x` → `修 x`）
    pub message: String,
    pub committed_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateR {
    /// 进行中的多步操作：rebase / merge / cherry-pick / revert / am；空闲为 null
    pub operation: Option<String>,
    pub stashes: Vec<StashR>,
    /// 冲突未解的文件（`--diff-filter=U`）
    pub conflicted: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashPushP {
    pub path: String,
    pub message: Option<String>,
    /// 未跟踪文件也一起收进储藏（`-u`）
    pub is_include_untracked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashRefP {
    pub path: String,
    pub index: u32,
    /// true = `stash pop`（应用后丢弃），false = `stash apply`（保留）
    pub is_pop: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseP {
    pub path: String,
    /// 变基目标；缺省 = 当前分支的上游（`git rebase` 无参数语义）
    pub upstream: Option<String>,
    /// 自动把未提交改动 stash 起来、变基完成后还原（`--autostash`）
    pub is_autostash: Option<bool>,
}

/// `stash list --format` 用单元分隔符隔开，避免说明里的冒号被误切
const STASH_FIELD_SEP: char = '\u{1f}';

async fn find_git_dir(cwd: &std::path::Path) -> Option<std::path::PathBuf> {
    let (ok, out, _) = run_git(cwd, &["rev-parse", "--absolute-git-dir"]).await.ok()?;
    if !ok {
        return None;
    }
    let dir = std::path::PathBuf::from(out.trim());
    if dir.is_dir() {
        Some(dir)
    } else {
        None
    }
}

/// 多步操作靠 git dir 里的标记文件判定：有标记就说明工作区处在中间态
fn detect_operation(git_dir: &std::path::Path) -> Option<String> {
    if git_dir.join("rebase-merge").is_dir() {
        return Some("rebase".into());
    }
    if git_dir.join("rebase-apply").is_dir() {
        // `git am` 也落在 rebase-apply，`applying` 文件是它独有的标记
        return Some(if git_dir.join("rebase-apply/applying").exists() {
            "am".into()
        } else {
            "rebase".into()
        });
    }
    if git_dir.join("MERGE_HEAD").exists() {
        return Some("merge".into());
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Some("cherry-pick".into());
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return Some("revert".into());
    }
    None
}

/// 储藏说明去掉 git 自己加的前缀：`On main: msg` / `WIP on main: 1a2b3c msg`
fn clean_stash_subject(subject: &str) -> String {
    let body = match subject.split_once(": ") {
        Some((_, rest)) => rest,
        None => subject,
    };
    let trimmed = body.trim();
    // WIP 形式带 7 位短 hash 前缀
    if trimmed.len() > 8 {
        let (head, rest) = trimmed.split_at(7);
        if head.bytes().all(|byte| byte.is_ascii_hexdigit()) && rest.starts_with(' ') {
            return rest.trim().to_string();
        }
    }
    trimmed.to_string()
}

async fn read_stashes(cwd: &std::path::Path) -> CommandResult<Vec<StashR>> {
    let format = format!("--format=%gd{STASH_FIELD_SEP}%gs{STASH_FIELD_SEP}%ct");
    let (ok, out, err) = run_git(cwd, &["stash", "list", &format]).await?;
    if !ok {
        // 还没有任何储藏时 git 也可能因为仓库状态报错；列表读失败不该挡住面板
        eprintln!("[git] 读取储藏列表失败：{err}");
        return Ok(Vec::new());
    }
    let mut stashes = Vec::new();
    for line in out.lines() {
        let mut parts = line.split(STASH_FIELD_SEP);
        let selector = parts.next().unwrap_or("").trim().to_string();
        let subject = parts.next().unwrap_or("").to_string();
        let committed_at = parts
            .next()
            .unwrap_or("")
            .trim()
            .parse::<i64>()
            .unwrap_or(0);
        if selector.is_empty() {
            continue;
        }
        let index = selector
            .rsplit_once('{')
            .and_then(|(_, rest)| rest.trim_end_matches('}').parse::<u32>().ok())
            .unwrap_or(0);
        stashes.push(StashR {
            index,
            selector,
            message: clean_stash_subject(&subject),
            committed_at,
        });
    }
    Ok(stashes)
}

async fn read_conflicted(cwd: &std::path::Path) -> Vec<String> {
    match run_git(cwd, &["diff", "--name-only", "--diff-filter=U", "-z"]).await {
        Ok((true, out, _)) => out
            .split('\0')
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// 面板只要「有没有中间态、有几条储藏、哪些文件冲突」，一次读完
#[tauri::command(rename = "workspaceGit:state")]
pub async fn workspaceGitState(params: PathP) -> CommandResult<StateR> {
    let cwd = validate_path(&params.path)?;
    let stashes = read_stashes(&cwd).await?;
    let git_dir = find_git_dir(&cwd).await;
    let operation = git_dir.as_deref().and_then(detect_operation);
    let conflicted = read_conflicted(&cwd).await;
    Ok(StateR {
        operation,
        stashes,
        conflicted,
    })
}

#[tauri::command(rename = "workspaceGit:stashPush")]
pub async fn workspaceGitStashPush(params: StashPushP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let message = params.message.unwrap_or_default().trim().to_string();
    let mut args: Vec<String> = vec!["stash".into(), "push".into()];
    if params.is_include_untracked.unwrap_or(false) {
        args.push("-u".into());
    }
    if !message.is_empty() {
        if message.starts_with('-') {
            return Err(Exception::Validation("储藏说明不能以 - 开头".into()));
        }
        args.push("-m".into());
        args.push(message);
    }
    let (ok, stdout, err) = git::run_git_args(&cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "储藏失败".into()
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "已储藏当前改动".into()
        } else {
            stdout
        },
    })
}

#[tauri::command(rename = "workspaceGit:stashApply")]
pub async fn workspaceGitStashApply(params: StashRefP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let selector = format!("stash@{{{}}}", params.index);
    let is_pop = params.is_pop.unwrap_or(true);
    let verb = if is_pop { "pop" } else { "apply" };
    let (ok, stdout, err) = run_git(&cwd, &["stash", verb, &selector]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            format!("{verb} {selector} 失败")
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if is_pop {
            format!("已弹出 {selector}")
        } else {
            format!("已应用 {selector}")
        },
    })
}

#[tauri::command(rename = "workspaceGit:stashDrop")]
pub async fn workspaceGitStashDrop(params: StashRefP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let selector = format!("stash@{{{}}}", params.index);
    let (ok, stdout, err) = run_git(&cwd, &["stash", "drop", &selector]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            format!("删除 {selector} 失败")
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: format!("已删除 {selector}"),
    })
}

#[tauri::command(rename = "workspaceGit:rebase")]
pub async fn workspaceGitRebase(params: RebaseP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let upstream = match params.upstream.as_deref() {
        Some(raw) if !raw.trim().is_empty() => Some(validate_branch(raw)?.to_string()),
        _ => None,
    };
    let mut args: Vec<String> = vec!["rebase".into()];
    if params.is_autostash.unwrap_or(true) {
        args.push("--autostash".into());
    }
    if let Some(target) = upstream {
        args.push(target);
    }
    let (ok, stdout, err) = git::run_git_args(&cwd, &args).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        // 冲突时 git 已经把「怎么继续」写在 stderr，原样透出比改写更准确
        return Err(Exception::Internal(if detail.is_empty() {
            "变基失败".into()
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "变基完成".into()
        } else {
            stdout
        },
    })
}

/// `git rebase --continue`：有冲突时由用户解开后手动触发。
/// `-c core.editor=true` 挡掉 git 打开编辑器的情形（否则进程会挂住）。
#[tauri::command(rename = "workspaceGit:rebaseContinue")]
pub async fn workspaceGitRebaseContinue(params: PathP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let (ok, stdout, err) = run_git(&cwd, &["-c", "core.editor=true", "rebase", "--continue"]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            "继续变基失败".into()
        } else {
            detail
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "变基已继续".into()
        } else {
            stdout
        },
    })
}

#[tauri::command(rename = "workspaceGit:rebaseAbort")]
pub async fn workspaceGitRebaseAbort(params: PathP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let (ok, _, err) = run_git(&cwd, &["rebase", "--abort"]).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "中止变基失败".into()
        } else {
            err
        }));
    }
    bump_status(&cwd);
    Ok(ActionR {
        summary: "已中止变基，回到变基前".into(),
    })
}
