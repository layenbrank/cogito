//! 上游（upstream）分歧读取：领先 / 落后计数 + 两侧文件清单。
//!
//! 只读，全部走系统 `git`（与写路径同源）：`@{u}` 的解析、`rev-list --count`、
//! `diff --name-status` 都有成熟语义，不必在 gix 里重写一遍 rev-walk。
//!
//! 前端拿到 `headOid` / `upstreamOid` 后可直接复用既有的提交对提交 diff
//! （`oldOid = headOid, newOid = upstreamOid` 即「拉下来会变成什么」）。

use std::path::Path;

use cogito_core::CommandResult;
use serde::Serialize;

use super::cli::{run_git, run_git_args};
use super::history::{ShowFile, parse_name_status_z};

/// 单侧文件清单上限：远端分叉很大时不要把整仓塞进一次 IPC。
const FILE_CAP: usize = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamR {
    pub has_upstream: bool,
    /// 上游全名，如 `origin/main`
    pub upstream: Option<String>,
    pub head_oid: Option<String>,
    pub upstream_oid: Option<String>,
    /// 本地独有提交数（待推送）
    pub ahead: u32,
    /// 上游独有提交数（待拉取）
    pub behind: u32,
    /// `HEAD -> @{u}`：拉下来会变的文件
    pub behind_files: Vec<ShowFile>,
    /// `@{u} -> HEAD`：推送会发出去的文件
    pub ahead_files: Vec<ShowFile>,
    pub behind_truncated: bool,
    pub ahead_truncated: bool,
}

/// 无上游时的空载荷（detached HEAD、没设 remote、浅克隆等）
fn empty(head_oid: Option<String>) -> UpstreamR {
    UpstreamR {
        has_upstream: false,
        upstream: None,
        head_oid,
        upstream_oid: None,
        ahead: 0,
        behind: 0,
        behind_files: Vec::new(),
        ahead_files: Vec::new(),
        behind_truncated: false,
        ahead_truncated: false,
    }
}

/// `git rev-list --left-right --count @{u}...HEAD` → `"left\tright"`；
/// 左列是上游独有（behind），右列是本地独有（ahead）。
fn parse_rev_list_count(raw: &str) -> (u32, u32) {
    let mut parts = raw.split_whitespace();
    let behind = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let ahead = parts
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    (behind, ahead)
}

async fn read_head_oid(cwd: &Path) -> Option<String> {
    match run_git(cwd, &["rev-parse", "HEAD"]).await {
        Ok((true, out, _)) => {
            let trimmed = out.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        _ => None,
    }
}

async fn read_oid(cwd: &Path, spec: &str) -> Option<String> {
    match run_git(cwd, &["rev-parse", spec]).await {
        Ok((true, out, _)) => {
            let trimmed = out.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        _ => None,
    }
}

/// `git diff --name-status -z <from> <to>`；失败（浅克隆缺对象等）降级成空清单，
/// 不让整个状态条因为一侧读不到就报错。
async fn read_files(cwd: &Path, from: &str, to: &str) -> CommandResult<(Vec<ShowFile>, bool)> {
    let args: Vec<String> = [
        "diff".to_string(),
        "--name-status".to_string(),
        "-z".to_string(),
        from.to_string(),
        to.to_string(),
    ]
    .to_vec();
    let (ok, out, err) = run_git_args(cwd, &args).await?;
    if !ok {
        eprintln!("[git] upstream diff {from}..{to} 失败：{err}");
        return Ok((Vec::new(), false));
    }
    let mut files = parse_name_status_z(&out);
    let truncated = files.len() > FILE_CAP;
    if truncated {
        files.truncate(FILE_CAP);
    }
    Ok((files, truncated))
}

pub async fn read_upstream(cwd: &Path) -> CommandResult<UpstreamR> {
    let head_oid = read_head_oid(cwd).await;

    let upstream = match run_git(
        cwd,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .await?
    {
        (true, out, _) => {
            let name = out.trim().to_string();
            if name.is_empty() { None } else { Some(name) }
        }
        (false, _, _) => None,
    };

    let Some(upstream_name) = upstream else {
        return Ok(empty(head_oid));
    };

    let upstream_oid = read_oid(cwd, "@{u}").await;

    let (behind, ahead) =
        match run_git(cwd, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]).await? {
            (true, out, _) => parse_rev_list_count(&out),
            (false, _, _) => (0, 0),
        };

    let (behind_files, behind_truncated) = read_files(cwd, "HEAD", "@{u}").await?;
    let (ahead_files, ahead_truncated) = read_files(cwd, "@{u}", "HEAD").await?;

    Ok(UpstreamR {
        has_upstream: true,
        upstream: Some(upstream_name),
        head_oid,
        upstream_oid,
        ahead,
        behind,
        behind_files,
        ahead_files,
        behind_truncated,
        ahead_truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_rev_list_count;

    #[test]
    fn parse_counts() {
        assert_eq!(parse_rev_list_count("3\t1"), (3, 1));
        assert_eq!(parse_rev_list_count("0\t0\n"), (0, 0));
        assert_eq!(parse_rev_list_count("12 7"), (12, 7));
    }

    #[test]
    fn parse_counts_tolerates_junk() {
        assert_eq!(parse_rev_list_count(""), (0, 0));
        assert_eq!(parse_rev_list_count("x"), (0, 0));
        assert_eq!(parse_rev_list_count("5"), (5, 0));
    }
}
