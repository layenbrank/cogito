use std::path::{Path, PathBuf};

use cogito_core::{CommandResult, Exception};
use parking_lot::Mutex;

use super::path::has_git_marker;

static OPEN_HINT: Mutex<Option<PathBuf>> = Mutex::new(None);

pub struct ProbeInfo {
    pub is_repo: bool,
    pub branch: Option<String>,
}

/// 打开仓库；失败时仍可用 `.git` marker 判断「像仓库」。
pub fn open_repo(cwd: &Path) -> CommandResult<gix::Repository> {
    match gix::open(cwd) {
        Ok(repo) => {
            *OPEN_HINT.lock() = Some(cwd.to_path_buf());
            Ok(repo)
        }
        Err(err) => Err(Exception::Internal(format!("无法打开 Git 仓库：{err}"))),
    }
}

pub fn probe_repo(cwd: &Path) -> ProbeInfo {
    let marker = has_git_marker(cwd);
    match gix::open(cwd) {
        Ok(repo) => {
            *OPEN_HINT.lock() = Some(cwd.to_path_buf());
            let branch = repo
                .head_name()
                .ok()
                .flatten()
                .map(|name| name.shorten().to_string());
            ProbeInfo {
                is_repo: true,
                branch,
            }
        }
        Err(_) => ProbeInfo {
            is_repo: marker,
            branch: None,
        },
    }
}

/// HEAD commit id（十六进制），供指纹使用。
pub fn head_id_hex(repo: &gix::Repository) -> Option<String> {
    let id = repo.head_id().ok()?;
    Some(id.to_string())
}
