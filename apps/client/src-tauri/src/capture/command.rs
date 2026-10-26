use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use image::ImageReader;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};
use thinking_core::asset::Service as AssetService;
use thinking_database::Storage;
use thinking_database::entity::asset::{Read, ReadP, Remove, RemoveP};
use tokio::sync::oneshot;

use crate::capture::region::find_overlay_regions;
use crate::capture::schema::{CaptureRegion, ScreenshotResult};
use crate::capture::state::{CaptureHandshake, CapturePending};
use crate::overlay::command::{OVERLAY_LABEL, overlay_ensure, overlay_update_mode};
use crate::through::ThroughState;
use crate::utils::capture_retention::{
    ORPHAN_PROTECT_MS, PruneResult, RetentionPolicy, find_captures_dir, find_prune_ids,
    find_screenshots_dir, parse_candidate, prune_orphans, remove_managed_files,
};
use crate::utils::clock::now_ms;
use crate::utils::ipc;

/// 等前端把 DOM 藏好的上限；超时继续（低配机上 2×rAF + IPC 可能更慢）
const CONCEAL_TIMEOUT_MS: u64 = 120;
/// 等前端把冻结帧画上屏的上限；超时也 reveal（不能因为一次握手失败卡死截屏）
const READY_TIMEOUT_MS: u64 = 400;

/// 抓屏文件名序号：同一毫秒内的两次抓屏不会互相覆盖
static SCREENSHOT_SEQ: AtomicU64 = AtomicU64::new(0);


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
    let seq = SCREENSHOT_SEQ.fetch_add(1, Ordering::Relaxed);
    data_dir.join(format!("screenshot-{now}-{seq}.png"))
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

/// 不 hide 窗口：壳保持**真**透明显示，仅把内容 visibility:hidden，避免磁贴/截图 UI 进位图。
/// 前提：overlay 不得套 mica/acrylic（见前端 `appearance.syncNativeWindow`）；否则毛玻璃仍会进位图。
///
/// 有可见内容、或已经处于截屏态时都需要 conceal（后者是为了不把上一次的截屏 UI 拍进新图），
/// 并用「前端 DOM 隐藏确认」握手替代固定 sleep。
async fn conceal_overlay_visuals(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let has_content = app
        .try_state::<CaptureHandshake>()
        .map(|state| state.has_content())
        .unwrap_or(false);
    let in_screenshot = app
        .try_state::<ThroughState>()
        .map(|state| state.is_screenshot_mode())
        .unwrap_or(false);
    if !has_content && !in_screenshot {
        return false;
    }
    let Some(handshake) = app.try_state::<CaptureHandshake>() else {
        return false;
    };

    let (tx, rx) = oneshot::channel();
    handshake.arm_concealed(tx).await;
    let _ = app.emit("overlay://conceal", ());
    // 等待前端 DOM 隐藏确认；超时兜底（渲染进程异常时不至于卡死）
    let _ = tokio::time::timeout(Duration::from_millis(CONCEAL_TIMEOUT_MS), rx).await;
    true
}

fn reveal_overlay_visuals(app: &AppHandle) {
    let _ = app.emit("overlay://reveal", ());
}

/// 挂上「冻结帧已上屏」的握手；返回 None 表示状态不可用（直接跳过等待）。
async fn arm_ready(app: &AppHandle) -> Option<oneshot::Receiver<()>> {
    let handshake = app.try_state::<CaptureHandshake>()?;
    let (tx, rx) = oneshot::channel();
    handshake.arm_ready(tx).await;
    Some(rx)
}

/// 等前端首帧；超时也继续，绝不能因为握手失败把截屏卡死。
async fn wait_ready(ready: Option<oneshot::Receiver<()>>) {
    if let Some(rx) = ready {
        let _ = tokio::time::timeout(Duration::from_millis(READY_TIMEOUT_MS), rx).await;
    }
}

/// 一次完整抓屏：
/// conceal（藏旧 UI）→ 摆好浮层 → 枚举选区窗口 → 抓帧 → 切截屏态 → 等首帧 → reveal。
///
/// 顺序是硬约束：`find_overlay_regions` 需要浮层自己的 hwnd 与 scale factor；
/// reveal 必须晚于前端把冻结帧画上屏，否则会露出实时桌面。
///
/// `await_first_frame`：重新截图时前端仍挂载着（loading 蒙版已不透明），
/// 不能等它回报 ready —— 那要等本次调用返回之后才会发生，会白等一个超时。
async fn capture_once(app: &AppHandle, await_first_frame: bool) -> Result<ScreenshotResult, String> {
    let concealed = conceal_overlay_visuals(app).await;
    overlay_ensure(app.clone()).await?;

    let regions = find_overlay_regions(app);
    let mut shot = match grab_screenshot(app).await {
        Ok(shot) => shot,
        Err(error) => {
            if concealed {
                reveal_overlay_visuals(app);
            }
            return Err(error);
        }
    };
    shot.regions = regions;

    // 先挂 ready 再切模式：前端可能在 emit 返回前就回报
    let ready = if await_first_frame {
        arm_ready(app).await
    } else {
        None
    };
    let mode = overlay_update_mode(app.clone(), "screenshot".into()).await;
    wait_ready(ready).await;
    // 无论切模式是否成功都要撤掉 conceal，否则浮层会一直是隐藏态
    reveal_overlay_visuals(app);
    mode?;
    Ok(shot)
}

/// 截取主显示器（corex PNG），返回路径与尺寸
#[tauri::command(rename = "capture:screenshot")]
pub async fn capture_screenshot(app: AppHandle) -> Result<ScreenshotResult, String> {
    let concealed = conceal_overlay_visuals(&app).await;
    overlay_ensure(app.clone()).await?;
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
    // 单飞：连按快捷键只抓一次（否则 pending 被覆盖、还可能把遮罩自己拍进去）
    if !pending.try_begin() {
        return Ok(());
    }
    let result = capture_once(&app, true).await;
    pending.end();

    let shot = result?;
    *pending.screenshot.lock().await = Some(shot);
    Ok(())
}

/// 重新截图：整体重来一遍，新帧直接返回（前端重置标注后重新载入）。
#[tauri::command(rename = "capture:refresh")]
pub async fn capture_refresh(
    app: AppHandle,
    pending: State<'_, CapturePending>,
) -> Result<ScreenshotResult, String> {
    if !pending.try_begin() {
        return Err("[capture:refresh] 上一次截屏还没结束".to_string());
    }
    let result = capture_once(&app, false).await;
    pending.end();
    result
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

/// overlay 前端在内容（磁贴/贴图）变化时上报，供截屏前判断是否要 conceal。
#[tauri::command(rename = "overlay:report-content")]
pub async fn overlay_report_content(app: AppHandle, has_content: bool) -> Result<(), String> {
    if let Some(state) = app.try_state::<CaptureHandshake>() {
        state.set_has_content(has_content);
    }
    Ok(())
}

/// overlay 前端 conceal DOM 隐藏完成后的确认；宿主据此继续截屏（替代固定 sleep）。
#[tauri::command(rename = "overlay:concealed")]
pub async fn overlay_concealed(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<CaptureHandshake>() {
        if let Some(tx) = state.take_concealed().await {
            let _ = tx.send(());
        }
    }
    Ok(())
}

/// 截屏浮层的冻结帧已画上屏；宿主收到后才 reveal（撤掉 conceal），避免露出实时桌面。
#[tauri::command(rename = "capture:ready")]
pub async fn capture_ready(app: AppHandle) -> Result<(), String> {
    if let Some(state) = app.try_state::<CaptureHandshake>() {
        if let Some(tx) = state.take_ready().await {
            let _ = tx.send(());
        }
    }
    Ok(())
}

/// 选择器元素级探测的入参（overlay 局部逻辑像素）
#[derive(Debug, Deserialize)]
pub struct ElementParams {
    pub x: f64,
    pub y: f64,
}

/// 取字入参：原图路径 + 可选裁剪（物理像素）
#[derive(Debug, Deserialize)]
pub struct OcrParams {
    pub path: String,
    #[serde(default)]
    pub crop: Option<OcrCrop>,
    /// 识别语言；corex 侧可选参数，不传用默认
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
pub struct OcrCrop {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Serialize)]
pub struct OcrResult {
    pub text: String,
}

/// 把物理像素裁剪区域另存为临时 PNG；坐标先夹到图像范围内（crop_imm 越界会 panic）
fn crop_to_temp(app: &AppHandle, source: &str, crop: &OcrCrop) -> Result<String, String> {
    let image = ImageReader::open(Path::new(source))
        .map_err(|e| format!("[capture:ocr] 打开原图失败 ({source}): {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("[capture:ocr] 识别原图格式失败 ({source}): {e}"))?
        .decode()
        .map_err(|e| format!("[capture:ocr] 解码原图失败 ({source}): {e}"))?;

    let full_w = i64::from(image.width());
    let full_h = i64::from(image.height());
    let x = crop.x.clamp(0, full_w);
    let y = crop.y.clamp(0, full_h);
    let width = crop.width.clamp(0, full_w - x);
    let height = crop.height.clamp(0, full_h - y);
    if width < 1 || height < 1 {
        return Err("[capture:ocr] 选区为空".to_string());
    }

    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("[capture:ocr] 获取数据目录失败: {e}"))?
        .join("captures");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("[capture:ocr] 创建目录失败 ({}): {e}", dir.display()))?;
    let seq = SCREENSHOT_SEQ.fetch_add(1, Ordering::Relaxed);
    let target = dir.join(format!("ocr-{}-{seq}.png", now_ms()));

    image
        .crop_imm(x as u32, y as u32, width as u32, height as u32)
        .save(&target)
        .map_err(|e| format!("[capture:ocr] 保存裁剪图失败 ({}): {e}", target.display()))?;
    Ok(target.to_string_lossy().into_owned())
}

/// 从 daemon 返回里尽力取出文本：字段名不同的版本都能兜住
fn find_ocr_text(data: &serde_json::Value) -> String {
    if let Some(text) = data.as_str() {
        return text.to_string();
    }
    for key in ["text", "content", "result"] {
        if let Some(text) = data.get(key).and_then(|value| value.as_str()) {
            return text.to_string();
        }
    }
    for key in ["lines", "blocks", "items"] {
        if let Some(rows) = data.get(key).and_then(|value| value.as_array()) {
            let lines: Vec<&str> = rows
                .iter()
                .filter_map(|row| row.get("text").and_then(|value| value.as_str()))
                .collect();
            if !lines.is_empty() {
                return lines.join("\n");
            }
        }
    }
    String::new()
}

/// 取字：选区裁剪 → corex `capture.ocr` → 文本
#[tauri::command(rename = "capture:ocr")]
pub async fn capture_ocr(app: AppHandle, params: OcrParams) -> Result<OcrResult, String> {
    let file = match params.crop.clone() {
        // 解码/裁剪整张 4K PNG 是重活，别占着 async 线程
        Some(crop) => {
            let app = app.clone();
            let source = params.path.clone();
            tokio::task::spawn_blocking(move || crop_to_temp(&app, &source, &crop))
                .await
                .map_err(|e| format!("[capture:ocr] 裁剪线程异常: {e}"))??
        }
        None => params.path.clone(),
    };

    let mut payload = json!({ "file": file });
    if let Some(language) = params.language.as_ref().filter(|text| !text.is_empty()) {
        payload["language"] = json!(language);
    }

    let resp = tokio::task::spawn_blocking(move || {
        ipc::invoke_with("capture", Some("ocr"), payload)
    })
    .await
    .map_err(|e| format!("[capture:ocr] IPC 线程异常: {e}"))??;

    if !resp.ok {
        return Err(resp
            .error
            .unwrap_or_else(|| "[capture:ocr] 识别失败".to_string()));
    }
    let data = resp.data.unwrap_or(serde_json::Value::Null);
    Ok(OcrResult {
        text: find_ocr_text(&data),
    })
}


/// 光标下的元素链（由细到粗）。查询失败返回空数组，前端自动退化为窗口级。
#[tauri::command(rename = "capture:elements")]
pub async fn capture_elements(
    app: AppHandle,
    params: ElementParams,
) -> Result<Vec<CaptureRegion>, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, params);
        return Ok(Vec::new());
    }

    #[cfg(windows)]
    {
        use crate::capture::region::{OverlayFrame, RegionMeta, ScreenBox};
        use crate::capture::schema::RegionKind;

        let Some(frame) = OverlayFrame::find(&app) else {
            return Ok(Vec::new());
        };
        let own_hwnd = frame.hwnd_text();

        let elements =
            crate::capture::uia::find_chain_through_overlay(&app, params.x, params.y).await;
        Ok(elements
            .into_iter()
            .filter_map(|element| {
                let hwnd = if element.hwnd > 0 {
                    format!("{:x}", element.hwnd as usize)
                } else {
                    String::new()
                };
                // 穿透失败时会把我们自己的 webview 返回回来，这种候选要丢掉
                if own_hwnd.as_ref().is_some_and(|own| own == &hwnd) {
                    return None;
                }
                let meta = RegionMeta {
                    kind: RegionKind::Element,
                    hwnd,
                    title: element.name,
                    z: 0,
                    control_type: element.control_type,
                };
                frame.to_region(
                    ScreenBox {
                        left: element.rect.left,
                        top: element.rect.top,
                        right: element.rect.right,
                        bottom: element.rect.bottom,
                    },
                    &meta,
                )
            })
            .collect())
    }
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
    freed = freed.saturating_add(prune_orphans(&captures_dir, &referenced, clock, protect));
    freed = freed.saturating_add(prune_orphans(&screenshots_dir, &referenced, clock, protect));

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
