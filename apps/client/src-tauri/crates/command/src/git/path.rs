use std::path::{Path, PathBuf};

use cogito_core::{CommandResult, Exception};

/// Windows `canonicalize` 会加 `\\?\`；git / 部分 Win32 API 不认，剥掉后再当 cwd。
pub fn strip_windows_verbatim_prefix(path: PathBuf) -> PathBuf {
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
pub fn path_for_safe_directory(path: &Path) -> String {
    strip_windows_verbatim_prefix(path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

/// 与资源管理器同一判据：工作区根下存在 `.git` 目录或 worktree 的 `.git` 文件。
pub fn has_git_marker(cwd: &Path) -> bool {
    let marker = cwd.join(".git");
    match std::fs::symlink_metadata(&marker) {
        Ok(meta) => meta.is_dir() || meta.is_file(),
        Err(_) => false,
    }
}

pub fn validate_path(path: &str) -> CommandResult<PathBuf> {
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

pub fn validate_branch(branch: &str) -> CommandResult<&str> {
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

pub fn validate_relative_paths(paths: &[String]) -> CommandResult<Vec<String>> {
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
