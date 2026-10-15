use std::collections::HashSet;
use std::path::Path;
use std::time::{Duration, SystemTime};

use image::ImageReader;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use thinking_core::asset::Service as AssetService;
use thinking_database::Storage;
use thinking_database::entity::asset::{Read, ReadP, Remove, RemoveP};

use crate::capture::region::find_overlay_regions;
use crate::capture::schema::ScreenshotResult;
use crate::capture::state::CapturePending;
use crate::overlay::command::{OVERLAY_LABEL, overlay_update_mode};
use crate::utils::capture_retention::{
    ORPHAN_PROTECT_MS, PruneResult, RetentionPolicy, find_captures_dir, find_prune_ids,
    find_screenshots_dir, parse_candidate, prune_orphans, remove_managed_files,
};
use crate::utils::clock::now_ms;
use crate::utils::ipc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneParams {
    pub policies: Vec<RetentionPolicy>,
}

/// 只读图片头获取宽高，避免整图 decode
fn build_screenshot_result(path: &str, scale_factor: f32) -> Result<ScreenshotResult, String> {
    let reader = ImageReader::open(Path::new(path))
        .map_err(|e| format!("[capture:screenshot] 打开截图失败 ({path}): {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("[capture:screenshot] 识别截图格式失败 ({path}): {e}"))?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|e| format!("[capture:screenshot] 读取截图尺寸失败 ({path}): {e}"))?;
    Ok(ScreenshotResult {
        path: path.to_string(),
        width,
        height,
        scale_factor,
        regions: Vec::new(),
    })
}

fn screenshot_from_ipc_data(path: String, data: &serde_json::Value) -> Option<ScreenshotResult> {
    let width = data
        .get("width")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)?;
    let height = data
        .get("height")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)?;
    Some(ScreenshotResult {
        path,
        width,
        height,
        scale_factor: 1.0,
        regions: Vec::new(),
    })
}

/// 截图目标文件。
///
/// corex 的 `capture.screenshot.to` 必须是**文件路径**（靠扩展名推断图片格式）：
/// 传目录会直接执行失败（`保存截图失败: The image format could not be determined`）。
fn build_screenshot_target(data_dir: &Path, now: i64) -> std::path::PathBuf {
    data_dir.join(format!("screenshot-{now}.png"))
}

/// 经 corex IPC 截主屏并落盘 PNG（单路径；尺寸优先用 IPC data）
async fn grab_screenshot(app: &AppHandle) -> Result<ScreenshotResult, String> {
    let data_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("[capture:screenshot] 获取数据目录失败: {e}"))?
        .join("screenshots");
    std::fs::create_dir_all(&data_dir).map_err(|e| {
        format!(
            "[capture:screenshot] 创建截图目录失败 ({}): {e}",
            data_dir.display()
        )
    })?;

    let target = build_screenshot_target(&data_dir, now_ms());
    let target_str = target.to_string_lossy().into_owned();
    let target_for_err = target_str.clone();

    let resp = tokio::task::spawn_blocking(move || {
        ipc::invoke_with(
            "capture",
            Some("screenshot"),
            json!({ "to": target_str, "format": "png" }),
        )
    })
    .await
    .map_err(|e| format!("[capture:screenshot] IPC 线程异常: {e}"))??;

    if !resp.ok {
        return Err(resp
            .error
            .unwrap_or_else(|| "[capture:screenshot] 截图失败".to_string()));
    }
    let path = match resp.path {
        Some(path) => path,
        // 目标路径是本端给定的，不回传时直接沿用，避免「写成功却报没路径」
        None => target_for_err,
    };

    if let Some(data) = resp.data.as_ref() {
        if let Some(result) = screenshot_from_ipc_data(path.clone(), data) {
            return Ok(result);
        }
    }

    tokio::task::spawn_blocking(move || build_screenshot_result(&path, 1.0))
        .await
        .map_err(|e| format!("[capture:screenshot] 截图处理线程异常: {e}"))?
}

/// 不 hide 窗口：壳保持透明显示，仅把内容 visibility:hidden，避免磁贴/截图 UI 进位图
async fn conceal_overlay_visuals(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return false;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        let _ = app.emit("overlay://conceal", ());
        tokio::time::sleep(std::time::Duration::from_millis(60)).await;
    }
    was_visible
}

fn reveal_overlay_visuals(app: &AppHandle) {
    let _ = app.emit("overlay://reveal", ());
}

/// 截取主显示器（corex PNG），返回路径与尺寸
#[tauri::command(rename = "capture:screenshot")]
pub async fn capture_screenshot(app: AppHandle) -> Result<ScreenshotResult, String> {
    let concealed = conceal_overlay_visuals(&app).await;
    let regions = find_overlay_regions(&app);
    let result = grab_screenshot(&app).await;
    if concealed {
        reveal_overlay_visuals(&app);
    }
    result.map(|mut shot| {
        shot.regions = regions;
        shot
    })
}

/// 先截图再进入 screenshot 模式，避免空层等待。overlay 窗口保持显示。
#[tauri::command(rename = "capture:open")]
pub async fn capture_open(
    app: AppHandle,
    pending: State<'_, CapturePending>,
) -> Result<(), String> {
    let concealed = conceal_overlay_visuals(&app).await;
    let regions = find_overlay_regions(&app);
    let result = match grab_screenshot(&app).await {
        Ok(mut result) => {
            result.regions = regions;
            result
        }
        Err(err) => {
            if concealed {
                reveal_overlay_visuals(&app);
            }
            return Err(err);
        }
    };
    {
        let mut guard = pending.screenshot.lock().await;
        *guard = Some(result);
    }
    let mode = overlay_update_mode(app.clone(), "screenshot".into()).await;
    reveal_overlay_visuals(&app);
    mode
}

/// 消费 capture:open 预截结果（一次性 take）
#[tauri::command(rename = "capture:take-pending")]
pub async fn capture_take_pending(
    pending: State<'_, CapturePending>,
) -> Result<Option<ScreenshotResult>, String> {
    let mut guard = pending.screenshot.lock().await;
    Ok(guard.take())
}

/// 退出 screenshot：清空 pending 并回 idle
#[tauri::command(rename = "capture:close")]
pub async fn capture_close(
    app: AppHandle,
    pending: State<'_, CapturePending>,
) -> Result<(), String> {
    {
        let mut guard = pending.screenshot.lock().await;
        *guard = None;
    }
    overlay_update_mode(app, "idle".into()).await
}

/// 按保留策略清理捕获历史，并回收 captures/screenshots 孤儿文件。
#[tauri::command(rename = "capture:prune")]
pub async fn capture_prune(
    app: AppHandle,
    storage: State<'_, Storage>,
    params: PruneParams,
) -> Result<PruneResult, String> {
    let assets = AssetService::toRead(storage.connection(), ReadP::One(Read::default()))
        .await
        .map_err(|e| e.to_string())?;

    let mut candidates = Vec::new();
    let mut referenced = HashSet::new();
    for asset in &assets {
        referenced.insert(asset.file_path.replace('\\', "/").to_lowercase());
        if let Some(candidate) = parse_candidate(
            &asset.id,
            &asset.file_path,
            asset.size,
            asset.created_at,
            asset.metadata.as_deref(),
        ) {
            candidates.push(candidate);
        }
    }

    let doomed = find_prune_ids(&candidates, &params.policies, now_ms());
    let app_local = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("[capture:prune] 数据目录失败: {e}"))?;
    let captures_dir = find_captures_dir(&app_local);
    let screenshots_dir = find_screenshots_dir(&app_local);

    let mut freed = remove_managed_files(&candidates, &doomed, &captures_dir);

    if !doomed.is_empty() {
        let removes: Vec<Remove> = doomed
            .iter()
            .map(|id| Remove {
                id: Some(id.clone()),
                tenant_id: None,
                kind: None,
                hash: None,
                mime: None,
                extension: None,
                file_name: None,
                status: None,
                device_id: None,
                archived_at: None,
            })
            .collect();
        let _ = AssetService::toRemove(storage.connection(), RemoveP::Many(removes))
            .await
            .map_err(|e| e.to_string())?;
    }

    let protect = Duration::from_millis(ORPHAN_PROTECT_MS);
    let clock = SystemTime::now();
    freed = freed.saturating_add(prune_orphans(
        &captures_dir,
        &referenced,
        clock,
        protect,
    ));
    freed = freed.saturating_add(prune_orphans(
        &screenshots_dir,
        &referenced,
        clock,
        protect,
    ));

    Ok(PruneResult {
        ids: doomed.into_iter().collect(),
        freed_bytes: freed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_target_is_a_png_file() {
        let target = build_screenshot_target(Path::new("C:/data/screenshots"), 1_700_000_000_000);
        assert_eq!(
            target.file_name().and_then(|name| name.to_str()),
            Some("screenshot-1700000000000.png")
        );
        assert_eq!(target.extension().and_then(|ext| ext.to_str()), Some("png"));
    }
}
