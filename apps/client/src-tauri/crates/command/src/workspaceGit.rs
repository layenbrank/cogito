#![allow(non_snake_case)]

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

fn validate_path(path: &str) -> CommandResult<std::path::PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(Exception::Validation("路径不能为空".into()));
    }
    if trimmed.contains("..") {
        return Err(Exception::Validation("路径非法".into()));
    }
    let buf = std::path::PathBuf::from(trimmed);
    if !buf.is_absolute() {
        return Err(Exception::Validation("路径必须为绝对路径".into()));
    }
    let canonical = buf
        .canonicalize()
        .map_err(|err| Exception::Validation(format!("路径无效：{err}")))?;
    if !canonical.is_dir() {
        return Err(Exception::Validation("路径不是有效目录".into()));
    }
    Ok(canonical)
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

async fn run_git(cwd: &std::path::Path, args: &[&str]) -> CommandResult<(bool, String, String)> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|err| Exception::Internal(format!("无法执行 git：{err}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Ok((output.status.success(), stdout, stderr))
}

#[tauri::command(rename = "workspaceGit:probe")]
pub async fn workspaceGitProbe(params: PathP) -> CommandResult<ProbeR> {
    let cwd = validate_path(&params.path)?;
    let (ok, _, _) = run_git(&cwd, &["rev-parse", "--is-inside-work-tree"]).await?;
    if !ok {
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
