#![allow(non_snake_case)]

use std::path::{Path, PathBuf};

use cogito_core::{CommandResult, Exception};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

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

/// Windows `canonicalize` 会加 `\\?\`；git / 部分 Win32 API 不认，剥掉后再当 cwd。
fn strip_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
    }
    path
}

/// `safe.directory` 比较用正斜杠路径（与 git 自己的提示一致）。
fn path_for_safe_directory(path: &Path) -> String {
    strip_windows_verbatim_prefix(path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

/// 与资源管理器同一判据：工作区根下存在 `.git` 目录或 worktree 的 `.git` 文件。
fn has_git_marker(cwd: &Path) -> bool {
    let marker = cwd.join(".git");
    match std::fs::symlink_metadata(&marker) {
        Ok(meta) => meta.is_dir() || meta.is_file(),
        Err(_) => false,
    }
}

fn validate_path(path: &str) -> CommandResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("路径不能为空".into()));
    }
    let normalized = strip_windows_verbatim_prefix(PathBuf::from(trimmed));
    let text = normalized.to_string_lossy();
    if text.split(['/', '\\']).any(|seg| seg == "..") {
        return Err(Exception::Validation("路径非法".into()));
    }
    if !normalized.is_absolute() {
        return Err(Exception::Validation("路径必须为绝对路径".into()));
    }
    let canonical = normalized
        .canonicalize()
        .map_err(|err| Exception::Validation(format!("路径无效：{err}")))?;
    if !canonical.is_dir() {
        return Err(Exception::Validation("路径不是有效目录".into()));
    }
    Ok(strip_windows_verbatim_prefix(canonical))
}

fn validate_branch(branch: &str) -> CommandResult<&str> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("分支名不能为空".into()));
    }
    if trimmed.contains("..") || trimmed.starts_with('-') {
        return Err(Exception::Validation("非法分支名".into()));
    }
    let ok = trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'));
    if !ok {
        return Err(Exception::Validation("分支名包含非法字符".into()));
    }
    Ok(trimmed)
}

async fn run_git_args(cwd: &Path, args: &[String]) -> CommandResult<(bool, String, String)> {
    // 用户显式打开的工作区视为可信：对齐 VS Code「信任工作区」后可操作 Git。
    // 否则跨用户拷贝 / SID 不可转换时，git 会因 dubious ownership 直接失败，
    // 资源管理器能看见 `.git`，SCM 却误报「不是 Git 仓库」。
    let safe = path_for_safe_directory(cwd);
    let mut full_args = Vec::with_capacity(args.len() + 2);
    full_args.push("-c".to_string());
    full_args.push(format!("safe.directory={safe}"));
    full_args.extend(args.iter().cloned());

    let mut command = Command::new("git");
    command.args(&full_args).current_dir(cwd);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .await
        .map_err(|err| Exception::Internal(format!("无法执行 git：{err}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), stdout, stderr))
}

async fn run_git(cwd: &Path, args: &[&str]) -> CommandResult<(bool, String, String)> {
    let owned: Vec<String> = args.iter().map(|item| (*item).to_string()).collect();
    run_git_args(cwd, &owned).await
}

#[tauri::command(rename = "workspaceGit:probe")]
pub async fn workspaceGitProbe(params: PathP) -> CommandResult<ProbeR> {
    let cwd = validate_path(&params.path)?;
    let marker = has_git_marker(&cwd);
    let (ok, inside, _) = run_git(&cwd, &["rev-parse", "--is-inside-work-tree"]).await?;
    let is_inside = ok && inside.eq_ignore_ascii_case("true");
    // 文件系统 `.git` 与 git 探测任一成立即视为仓库（对齐 VS Code isGitRepository）
    if !is_inside && !marker {
        return Ok(ProbeR {
            is_repo: false,
            branch: None,
        });
    }
    let (branch_ok, branch, _) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    Ok(ProbeR {
        is_repo: true,
        branch: if branch_ok && !branch.is_empty() {
            Some(branch)
        } else {
            None
        },
    })
}

#[tauri::command(rename = "workspaceGit:branches")]
pub async fn workspaceGitBranches(params: PathP) -> CommandResult<BranchesR> {
    let cwd = validate_path(&params.path)?;
    let (ok, _, err) = run_git(&cwd, &["rev-parse", "--is-inside-work-tree"]).await?;
    if !ok {
        return Err(Exception::Validation(if err.is_empty() {
            "不是 Git 仓库".into()
        } else {
            err
        }));
    }
    let (cur_ok, current, cur_err) = run_git(&cwd, &["rev-parse", "--abbrev-ref", "HEAD"]).await?;
    if !cur_ok {
        return Err(Exception::Internal(if cur_err.is_empty() {
            "无法读取当前分支".into()
        } else {
            cur_err
        }));
    }
    let (list_ok, listed, list_err) =
        run_git(&cwd, &["branch", "--format=%(refname:short)"]).await?;
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
    Ok(BranchesR { current, branches })
}

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
    Ok(CheckoutR { branch })
}

/* ─── 变更状态 ─── */

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StatusEntryR {
    pub path: String,
    /// 暂存区状态字符（`git status` 的 X）
    pub index_status: String,
    /// 工作区状态字符（Y）
    pub worktree_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusR {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub entries: Vec<StatusEntryR>,
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
    /// 未跟踪文件要整份删除，必须由前端显式声明
    pub is_untracked: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffP {
    pub path: String,
    /// 相对仓库根的路径
    pub file_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffR {
    pub original: String,
    pub modified: String,
    pub is_binary: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitP {
    pub path: String,
    pub message: String,
    /// true：先 `git add -A` 再提交；false：只提交已暂存内容
    pub is_stage_all: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionR {
    pub summary: String,
}

fn validate_relative_paths(paths: &[String]) -> CommandResult<Vec<String>> {
    if paths.is_empty() {
        return Err(Exception::Validation("未选择文件".into()));
    }
    let mut cleaned = Vec::with_capacity(paths.len());
    for path in paths {
        let trimmed = path.trim().replace('\\', "/");
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('-')
            || trimmed.starts_with('/')
            || trimmed.contains("..")
            || trimmed.contains(':')
        {
            return Err(Exception::Validation("文件路径非法".into()));
        }
        cleaned.push(trimmed);
    }
    if cleaned.is_empty() {
        return Err(Exception::Validation("未选择文件".into()));
    }
    Ok(cleaned)
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

#[tauri::command(rename = "workspaceGit:status")]
pub async fn workspaceGitStatus(params: PathP) -> CommandResult<StatusR> {
    let cwd = validate_path(&params.path)?;
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
    let (ok, stdout, err) = run_git_args(&cwd, &args).await?;
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
        // 重命名/复制会多跟一段原始路径，跳过
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
    })
}

#[tauri::command(rename = "workspaceGit:diff")]
pub async fn workspaceGitDiff(params: DiffP) -> CommandResult<DiffR> {
    let cwd = validate_path(&params.path)?;
    let mut cleaned = validate_relative_paths(&[params.file_path])?;
    let file_path = cleaned.remove(0);

    let spec = format!("HEAD:{file_path}");
    let (has_head, original, _) = run_git_args(&cwd, &["show".into(), spec]).await?;
    let original = if has_head { original } else { String::new() };

    let absolute = cwd.join(&file_path);
    let modified = std::fs::read(&absolute)
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default();

    let is_binary = looks_binary(original.as_bytes()) || looks_binary(modified.as_bytes());
    Ok(DiffR {
        original,
        modified,
        is_binary,
    })
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8 * 1024).any(|byte| *byte == 0)
}

#[tauri::command(rename = "workspaceGit:stage")]
pub async fn workspaceGitStage(params: PathsP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let paths = validate_relative_paths(&params.paths)?;
    let mut args: Vec<String> = vec!["add".into(), "-A".into(), "--".into()];
    args.extend(paths);
    let (ok, _, err) = run_git_args(&cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "暂存失败".into()
        } else {
            err
        }));
    }
    Ok(ActionR {
        summary: "已暂存".into(),
    })
}

#[tauri::command(rename = "workspaceGit:unstage")]
pub async fn workspaceGitUnstage(params: PathsP) -> CommandResult<ActionR> {
    let cwd = validate_path(&params.path)?;
    let paths = validate_relative_paths(&params.paths)?;
    let mut args: Vec<String> = vec![
        "restore".into(),
        "--staged".into(),
        "--".into(),
    ];
    args.extend(paths.clone());
    let (ok, _, _) = run_git_args(&cwd, &args).await?;
    if !ok {
        // 老版本 git 没有 restore
        let mut fallback: Vec<String> = vec!["reset".into(), "HEAD".into(), "--".into()];
        fallback.extend(paths);
        let (fallback_ok, _, fallback_err) = run_git_args(&cwd, &fallback).await?;
        if !fallback_ok {
            return Err(Exception::Internal(if fallback_err.is_empty() {
                "取消暂存失败".into()
            } else {
                fallback_err
            }));
        }
    }
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
    let (ok, _, err) = run_git_args(&cwd, &args).await?;
    if !ok {
        return Err(Exception::Internal(if err.is_empty() {
            "撤销更改失败".into()
        } else {
            err
        }));
    }
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
        let (stage_ok, _, stage_err) =
            run_git(&cwd, &["add", "-A"]).await?;
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
    // 只做快进，避免在轻量面板里产生需要人工处理的合并提交
    let (ok, stdout, err) = run_git(&cwd, &["pull", "--ff-only"]).await?;
    if !ok {
        let detail = if err.is_empty() { stdout } else { err };
        return Err(Exception::Internal(if detail.is_empty() {
            "拉取失败，请确认本地没有与远端冲突的提交".into()
        } else {
            detail
        }));
    }
    Ok(ActionR {
        summary: if stdout.is_empty() {
            "已是最新".into()
        } else {
            stdout
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{has_git_marker, path_for_safe_directory, strip_windows_verbatim_prefix};
    use std::path::PathBuf;

    #[test]
    fn strips_windows_verbatim_drive_and_unc() {
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\D:\Documents\electron\vite-ts")),
            PathBuf::from(r"D:\Documents\electron\vite-ts")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"\\?\UNC\server\share\dir")),
            PathBuf::from(r"\\server\share\dir")
        );
        assert_eq!(
            strip_windows_verbatim_prefix(PathBuf::from(r"D:\Documents\electron\vite-ts")),
            PathBuf::from(r"D:\Documents\electron\vite-ts")
        );
    }

    #[test]
    fn safe_directory_uses_forward_slashes() {
        let path = PathBuf::from(r"D:\Documents\electron\vite-ts");
        assert_eq!(
            path_for_safe_directory(&path),
            "D:/Documents/electron/vite-ts"
        );
    }

    #[test]
    fn git_marker_detects_directory() {
        let dir = std::env::temp_dir().join(format!("cogito-git-marker-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".git")).expect("mkdir .git");
        assert!(has_git_marker(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
