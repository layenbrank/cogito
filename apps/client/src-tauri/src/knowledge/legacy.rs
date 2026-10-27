//! 旧版「Markdown 备份」目录的清理。
//!
//! 旧版本每 30 秒往 `<应用数据>/markdown-backups` 写一份 `.bak`，那是纯垃圾：正文本来就以
//! 文件为准（`knowledge_doc.content` 只是快照，`hash` 负责冲突判定）。新版本不再写这个目录，
//! 但**已存在的旧文件不自动删** —— 删别人的文件必须由人点。
//!
//! 所以这里只有「看一眼」和「删掉」两个动作，别的一概不做：不迁移、不读内容、不碰知识库目录。

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use cogito_core::{CommandResult, Exception};

/// 旧版备份目录名（应用数据目录下的固定子目录）
const LEGACY_DIR: &str = "markdown-backups";

/// 扫描结果：界面拿它决定「要不要显示这一项」。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyBackup {
    /// 目录绝对路径（展示用，方便用户自己去开）
    pub path: String,
    /// 文件数量
    pub files: u64,
    /// 占用字节
    pub bytes: u64,
}

/// 旧备份目录位置。
fn legacy_dir(app: &AppHandle) -> Result<PathBuf, Exception> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|error| Exception::Validation(format!("找不到应用数据目录：{error}")))?;
    Ok(base.join(LEGACY_DIR))
}

/// 递归统计，顺带跳过符号链接（不跟出去，避免把别的地方算进来）。
fn scan(dir: &Path) -> (u64, u64) {
    let mut files = 0;
    let mut bytes = 0;
    let Ok(entries) = fs::read_dir(dir) else {
        return (files, bytes);
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            let (inner_files, inner_bytes) = scan(&entry.path());
            files += inner_files;
            bytes += inner_bytes;
            continue;
        }
        files += 1;
        bytes += entry.metadata().map(|meta| meta.len()).unwrap_or(0);
    }
    (files, bytes)
}

/// 查一下有没有旧备份残留。没有（或空目录）返回 `None`，界面就不显示这一项。
///
/// # Errors
/// 取应用数据目录失败。
#[tauri::command(rename = "knowledge:legacyScan")]
pub async fn knowledge_legacy_scan(app: AppHandle) -> CommandResult<Option<LegacyBackup>> {
    let dir = legacy_dir(&app)?;
    if !dir.is_dir() {
        return Ok(None);
    }
    let (files, bytes) = scan(&dir);
    if files == 0 {
        return Ok(None);
    }
    Ok(Some(LegacyBackup {
        path: dir.to_string_lossy().into_owned(),
        files,
        bytes,
    }))
}

/// 删掉旧备份目录，返回释放的字节数。
///
/// 删失败就报错（不要「删一半当成功」）：用户可以自己再去文件夹里处理。
///
/// # Errors
/// 取应用数据目录失败，或目录删不掉（被占用 / 没权限）。
#[tauri::command(rename = "knowledge:legacyRemove")]
pub async fn knowledge_legacy_remove(app: AppHandle) -> CommandResult<u64> {
    let dir = legacy_dir(&app)?;
    if !dir.is_dir() {
        return Ok(0);
    }
    let (_, bytes) = scan(&dir);
    fs::remove_dir_all(&dir)?;
    Ok(bytes)
}
