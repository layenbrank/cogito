//! `media:stat` / `media:scanDir` / `media:pick`（计划 S1 / 1A）。
//!
//! 图库导入原本在渲染进程里用 `@tauri-apps/plugin-fs` 直接 `stat` / `readDir` +
//! `plugin-dialog` 选目录。1A 把它们搬进 Rust 的原因不是"好看"，而是：
//! 收 `fs:scope` 之后渲染进程不该再有任意路径读盘能力，而图库要读的是**用户临时挑的目录**，
//! 不可能预先写进静态 scope。改由 Rust 执行后，放行范围由授权集（`security::grants`）与
//! 用户这次主动选择共同决定，渲染进程只拿到"文件清单"与"字节数"。
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// 与前端 `import-media.ts` 对齐的上限：目录深度 4 层、最多 400 个文件。
const DEFAULT_MAX_DEPTH: u32 = 4;
const DEFAULT_MAX_FILES: usize = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// 仅文件有值（目录不报"大小"）
    pub size: Option<u64>,
    pub is_file: bool,
    pub is_dir: bool,
    pub modified_ms: Option<i64>,
}

fn find_ext(name: &str) -> Option<String> {
    let path = Path::new(name);
    path.extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
}

fn collect_files(
    dir: &Path,
    depth: u32,
    max_depth: u32,
    max_files: usize,
    exts: &HashSet<String>,
    out: &mut Vec<String>,
) {
    if depth > max_depth || out.len() >= max_files {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_files {
            return;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            collect_files(&path, depth + 1, max_depth, max_files, exts, out);
            continue;
        }
        let Some(ext) = find_ext(&path.to_string_lossy()) else {
            continue;
        };
        if !exts.is_empty() && !exts.contains(&ext) {
            continue;
        }
        out.push(path.to_string_lossy().into_owned());
    }
}

/// 单个路径的元信息。前端只用 `size`（其余字段留给诊断）。
#[tauri::command]
pub async fn media_stat(path: String) -> Result<FileStat, String> {
    let meta = std::fs::metadata(&path).map_err(|error| format!("无法访问 {path}：{error}"))?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    Ok(FileStat {
        size: if meta.is_file() {
            Some(meta.len())
        } else {
            None
        },
        is_file: meta.is_file(),
        is_dir: meta.is_dir(),
        modified_ms,
    })
}

/// 递归收集目录下的媒体文件（只回文件绝对路径；目录不返回）。
///
/// `extensions` 为空表示不过滤。深度/数量上限与前端常量一致，避免一次导入把 UI 打爆。
#[tauri::command]
pub async fn media_scan_dir(
    dir: String,
    extensions: Option<Vec<String>>,
    max_depth: Option<u32>,
    max_files: Option<u32>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err(format!("{dir} 不是目录"));
    }
    let exts: HashSet<String> = extensions
        .unwrap_or_default()
        .into_iter()
        .map(|ext| ext.trim_start_matches('.').to_lowercase())
        .collect();
    let depth_limit = max_depth.unwrap_or(DEFAULT_MAX_DEPTH);
    let count_limit = max_files.map_or(DEFAULT_MAX_FILES, |value| value as usize);
    let mut out: Vec<String> = Vec::new();
    collect_files(&root, 0, depth_limit, count_limit, &exts, &mut out);
    Ok(out)
}

/// 系统对话框：`mode` = `"files"` | `"folders"`，返回用户选中的绝对路径。
///
/// 选完不做任何入库动作 —— 入库仍走 `asset:insert`（DB 写入只有一个入口）。
#[tauri::command]
pub async fn media_pick(
    app: AppHandle,
    mode: String,
    extensions: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let folders = mode == "folders";
    let grant_handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let dialog = match &extensions {
            Some(list) if !list.is_empty() => {
                let refs: Vec<&str> = list.iter().map(String::as_str).collect();
                dialog.add_filter("媒体", &refs)
            }
            _ => dialog,
        };
        if mode == "folders" {
            dialog
                .blocking_pick_folders()
                .unwrap_or_default()
                .into_iter()
                .map(|file| file.to_string())
                .collect::<Vec<_>>()
        } else {
            dialog
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .map(|file| file.to_string())
                .collect::<Vec<_>>()
        }
    })
    .await
    .map_err(|error| format!("选择文件失败：{error}"))?;

    let paths: Vec<String> = picked
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect();

    // 选完即授权：紧接着的 probe / 预览要走 plugin-fs 与 asset:，
    // 收 scope 之后没有这一步会当场读不到（用户刚亲自选的东西必须能读）。
    let granted: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    crate::security::grants::allow_paths(&grant_handle, &granted, folders);

    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_only_requested_extensions_and_respects_limits() {
        let base = std::env::temp_dir().join(format!("cogito-scan-{}", std::process::id()));
        let nested = base.join("nested");
        std::fs::create_dir_all(&nested).expect("mkdir");
        std::fs::write(base.join("a.png"), b"x").expect("write png");
        std::fs::write(base.join("b.txt"), b"x").expect("write txt");
        std::fs::write(nested.join("c.jpg"), b"x").expect("write jpg");

        let exts: HashSet<String> = ["png".to_string(), "jpg".to_string()].into_iter().collect();
        let mut out = Vec::new();
        collect_files(&base, 0, DEFAULT_MAX_DEPTH, 10, &exts, &mut out);
        out.sort();
        assert_eq!(out.len(), 2, "{out:?}");
        assert!(out.iter().any(|path| path.ends_with("a.png")));
        assert!(out.iter().any(|path| path.ends_with("c.jpg")));

        let mut capped = Vec::new();
        collect_files(&base, 0, DEFAULT_MAX_DEPTH, 1, &exts, &mut capped);
        assert_eq!(capped.len(), 1);

        std::fs::remove_dir_all(&base).ok();
    }
}
