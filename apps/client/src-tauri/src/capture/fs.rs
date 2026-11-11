//! `capture:savePng` / `capture:pinTexture`（计划 S1 / 1A）。
//!
//! 贴图与"另存为"原先在渲染进程里 `writeFile` —— 一个是 AppLocalData 下的 textures/，
//! 一个是用户选的任意路径。后者尤其不能留在渲染进程：收 scope 之后它会被拦，
//! 而放行整个磁盘又等于没收。改由 Rust 落盘，路径由用户在系统对话框里亲自选。
use std::path::PathBuf;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// data URL（`data:image/png;base64,...`）或裸 base64 → 字节。
fn decode_image(payload: &str) -> Result<Vec<u8>, String> {
    let body = match payload.split_once(',') {
        Some((head, rest)) if head.starts_with("data:") => rest,
        _ => payload,
    };
    STANDARD
        .decode(body.trim())
        .map_err(|error| format!("图片 base64 解码失败：{error}"))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// 贴图 / 截图的文件名：毫秒时间戳 + 进程内自增序号。
///
/// 只用毫秒会撞名 —— 连点两次贴图落在同一毫秒里，后者会覆盖前者（贴图链路
/// 直接丢一张图）。加个原子序号才是真的「每次唯一」，顺带让单测不必依赖时钟
/// 精度。
fn unique_png_name(prefix: &str) -> String {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!("{prefix}-{}-{seq}.png", now_ms())
}

/// 把贴图写进 `<appLocalData>/textures/<id>.png`，返回绝对路径（供 `asset:insert` 用）。
#[tauri::command]
pub async fn capture_pin_texture(app: AppHandle, data_url: String) -> Result<String, String> {
    let bytes = decode_image(&data_url)?;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("取应用数据目录失败：{error}"))?
        .join("textures");
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建 textures 目录失败：{error}"))?;
    let path = dir.join(unique_png_name("texture"));
    std::fs::write(&path, bytes).map_err(|error| format!("写入贴图失败：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 系统保存对话框 + 落盘；用户取消返回 `None`。
#[tauri::command]
pub async fn capture_save_png(
    app: AppHandle,
    data_url: String,
    default_name: Option<String>,
) -> Result<Option<String>, String> {
    let bytes = decode_image(&data_url)?;
    let file_name = default_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| unique_png_name("screenshot"));

    let picked: Option<PathBuf> = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_file_name(file_name)
            .add_filter("PNG 图片", &["png"])
            .blocking_save_file()
            .map(|file| PathBuf::from(file.to_string()))
    })
    .await
    .map_err(|error| format!("保存对话框失败：{error}"))?;

    let Some(path) = picked else {
        return Ok(None);
    };
    std::fs::write(&path, bytes)
        .map_err(|error| format!("写入 {} 失败：{error}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_data_url_and_bare_base64() {
        // "hi" = aGk=
        assert_eq!(decode_image("data:image/png;base64,aGk=").unwrap(), b"hi");
        assert_eq!(decode_image("aGk=").unwrap(), b"hi");
    }

    #[test]
    fn rejects_garbage() {
        assert!(decode_image("not-base64!!").is_err());
    }

    #[test]
    fn pin_texture_name_is_unique_per_call() {
        // 同一毫秒内连续取名字也不能撞（之前只靠 now_ms()，连点两次贴图会覆盖）
        let names: Vec<String> = (0..1_000).map(|_| unique_png_name("texture")).collect();
        let unique: std::collections::HashSet<&String> = names.iter().collect();
        assert_eq!(unique.len(), names.len(), "文件名必须每次唯一");
        assert!(names[0].starts_with("texture-"));
        assert!(names[0].ends_with(".png"));
    }
}
