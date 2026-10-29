//! 工作区 Git 只读栈：gix 读路径 + CLI 写路径 + status 指纹缓存。
//!
//! - 读：probe / blob / diffMeta / diffHunks / branches → gix
//! - status：默认 CLI porcelain（Windows 上 gix status 常更慢）；`COGITO_GIT_STATUS_BACKEND=cli|gix`
//! - 写：stage / unstage / discard / commit / fetch / pull → 系统 git；成功后 `bump_status`
//! - 缓存：HEAD oid + index mtime；watch → invalidate；载荷相同则 `unchanged`

mod blob;
mod cache;
mod cli;
mod diff;
mod path;
mod session;
mod status;

pub use blob::{prepare_side, read_head_bytes, read_worktree_bytes};
pub use cache::{
    bump_status, invalidate_status, mark_unchanged, status_cached, store_status, StatusLookup,
};
pub use cli::{run_git, run_git_args, run_git_bytes};
pub use diff::{plan_diff, plan_diff_hunks, DiffHunk, DiffHunksR, DiffMetaR, DiffMode, DiffPlan};
pub use path::{has_git_marker, validate_branch, validate_path, validate_relative_paths};
pub use session::{open_repo, probe_repo, ProbeInfo};
pub use status::{list_branches, read_status, StatusEntryR, StatusR};

/// 环境变量：`cli`（强制）| `gix`（默认标记，当前仍走 porcelain CLI 以对齐金样）。
///
/// 微基准：对本仓分别设 `COGITO_GIT_STATUS_BACKEND=cli|gix` 后连调 `workspaceGit:status`，
/// 取 P50；若 gix 实现补齐后仍慢于 CLI，保持默认 CLI。
pub fn status_backend() -> StatusBackend {
    match std::env::var("COGITO_GIT_STATUS_BACKEND")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "cli" => StatusBackend::Cli,
        _ => StatusBackend::Gix,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StatusBackend {
    Gix,
    Cli,
}
