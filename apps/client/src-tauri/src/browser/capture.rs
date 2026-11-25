//! 浏览器截图。
//!
//! 视口默认走 WebView2 `CapturePreview`（控件正在画的那张位图），对齐 VS Code
//! `webContents.capturePage`。`Page.captureScreenshot` 在 zoom ≠ 1 时不传 clip
//! 只会截到左上角一块，所以 CDP 只作为退路，而且 clip 必须乘上缩放。
//!
//! 缩放只取一条：`ScaleChannel::Zoom` 用控件 `ZoomFactor`，`ScaleChannel::Cdp`
//! 用设备模拟的 `scale`。两条叠乘会把画面再缩小一截（见 `emulate.rs`）。

use serde_json::{Value, json};
use tauri::AppHandle;

use super::cdp;
use super::emulate::ScaleChannel;
use super::intercept;

/// 等两帧再拍。页面刚 show 时合成器可能还是空的。
///
/// `requestAnimationFrame` 在隐藏 / 刚切回来时可能不跑，所以再兜一个定时器，
/// 避免 `awaitPromise` 挂到 CDP 的长超时。
pub(crate) const PAINT_FRAMES: &str = "new Promise((done) => {\
    let settled = false;\
    const finish = () => { if (settled) return; settled = true; done(true); };\
    requestAnimationFrame(() => requestAnimationFrame(finish));\
    setTimeout(finish, 100);\
})";

/// jpeg 质量：给模型看够用，体积比 png 小一个量级。
const JPEG_QUALITY: u8 = 75;
/// 触发缩小的体积（base64 字符数，约 300KB 原图）。
const JPEG_TRIGGER: usize = 400_000;
/// 视口 jpeg 长边上限（物理像素）。只缩小，不改宽高比。
const VIEWPORT_LONG_EDGE: u32 = 2048;
/// 整页长边上限，与 VS Code `MAX_FULL_PAGE_SCREENSHOT_DIMENSION` 相同。
const FULL_PAGE_LONG_EDGE: f64 = 2576.0;
/// 单次 CDP / 预览截图上限。
const CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(4000);
/// `CapturePreview` 偶发在首帧之前失败，多试几次。
const PREVIEW_ATTEMPTS: u32 = 5;

/// CDP `Page.captureScreenshot` 的 clip。坐标单位与协议一致（乘过 zoom 的 CSS px）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShotClip {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// 元素在页面上的矩形（CSS px，视口坐标 + 当时的滚动量）。
#[derive(Debug, Clone, Copy)]
pub struct CssRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scroll_x: f64,
    pub scroll_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LayoutBox {
    client_width: f64,
    client_height: f64,
    visual_scale: f64,
    content_width: f64,
    content_height: f64,
    device_width: f64,
}

/// 有限且为正才采用，否则回落到 fallback。
fn finite_positive(value: f64, fallback: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        fallback
    }
}

/// 合成进 clip 的缩放。zoom 与 emulation scale 只取当前通道那一条，再乘捏合缩放。
#[must_use]
pub fn pixel_scale(
    channel: ScaleChannel,
    zoom_factor: f64,
    emulation_scale: f64,
    visual_scale: f64,
) -> f64 {
    let base = match channel {
        ScaleChannel::Cdp => finite_positive(emulation_scale, 1.0),
        ScaleChannel::Zoom | ScaleChannel::None => finite_positive(zoom_factor, 1.0),
    };
    (base * finite_positive(visual_scale, 1.0)).max(0.01)
}

/// 视口 clip：原点在视口左上角，宽高乘 `pixel_scale`（Chromium 在 zoom ≠ 1 时的 workaround）。
#[must_use]
pub fn viewport_clip(client_width: f64, client_height: f64, pixel_scale: f64) -> ShotClip {
    let scale = finite_positive(pixel_scale, 1.0);
    ShotClip {
        x: 0.0,
        y: 0.0,
        width: finite_positive(client_width, 1.0) * scale,
        height: finite_positive(client_height, 1.0) * scale,
        scale: 1.0,
    }
}

/// 元素 clip：视口坐标 + 滚动 = 文档坐标，再整体乘 `pixel_scale`。`pad` 也乘，避免缩放后贴边。
#[must_use]
pub fn element_clip(rect: CssRect, pad: f64, pixel_scale: f64) -> ShotClip {
    let scale = finite_positive(pixel_scale, 1.0);
    let pad = pad.max(0.0) * scale;
    ShotClip {
        x: ((rect.x + rect.scroll_x) * scale - pad).max(0.0),
        y: ((rect.y + rect.scroll_y) * scale - pad).max(0.0),
        width: finite_positive(rect.width, 1.0) * scale + pad * 2.0,
        height: finite_positive(rect.height, 1.0) * scale + pad * 2.0,
        scale: 1.0,
    }
}

/// 整页 clip。`cssContentSize * pixel_scale`，再用 `scale` 把长边压进上限。
///
/// 输出像素大约是 `clip.width * clip.scale * dpr`，所以先用 dpr 把上限折回 clip 空间。
#[must_use]
pub fn full_page_clip(css_width: f64, css_height: f64, pixel_scale: f64, dpr: f64) -> ShotClip {
    let scale_px = finite_positive(pixel_scale, 1.0);
    let width = finite_positive(css_width, 1.0) * scale_px;
    let height = finite_positive(css_height, 1.0) * scale_px;
    let dpr = finite_positive(dpr, 1.0).max(1.0);
    let max_clip = FULL_PAGE_LONG_EDGE / dpr;
    let long_edge = width.max(height).max(1.0);
    let scale = (max_clip / long_edge).clamp(0.01, 1.0);
    ShotClip {
        x: 0.0,
        y: 0.0,
        width,
        height,
        scale,
    }
}

/// 设备像素 / CSS 像素。两边都不可用时按 1。
#[must_use]
pub fn infer_dpr(css_width: f64, device_width: f64) -> f64 {
    if css_width > 1.0 && device_width > 1.0 {
        (device_width / css_width).max(1.0)
    } else {
        1.0
    }
}

/// 按长边缩小后的尺寸。已经更小则原样返回。宽高比保持（四舍五入到像素）。
#[must_use]
pub fn fit_long_edge(width: u32, height: u32, long_edge: u32) -> (u32, u32) {
    let long = width.max(height);
    if long <= long_edge || long == 0 || width == 0 || height == 0 {
        return (width.max(1), height.max(1));
    }
    let ratio = f64::from(long_edge) / f64::from(long);
    let next_width = (f64::from(width) * ratio).round().max(1.0) as u32;
    let next_height = (f64::from(height) * ratio).round().max(1.0) as u32;
    (next_width, next_height)
}

/// 屏幕矩形（虚拟桌面像素）落在哪一块屏上，用中心点判断。
#[must_use]
pub fn find_screen(
    screens: &[(i32, i32, u32, u32)],
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Option<usize> {
    if width < 1 || height < 1 {
        return None;
    }
    let center_x = x.saturating_add(width / 2);
    let center_y = y.saturating_add(height / 2);
    screens.iter().position(|(left, top, screen_w, screen_h)| {
        let right = left.saturating_add(*screen_w as i32);
        let bottom = top.saturating_add(*screen_h as i32);
        center_x >= *left && center_x < right && center_y >= *top && center_y < bottom
    })
}

/// 把虚拟桌面矩形裁进某一块屏的图像坐标。完全落在外面则 `None`。
#[must_use]
pub fn crop_on_screen(
    screen_x: i32,
    screen_y: i32,
    rect_x: i32,
    rect_y: i32,
    rect_w: i32,
    rect_h: i32,
    image_w: u32,
    image_h: u32,
) -> Option<(u32, u32, u32, u32)> {
    if image_w == 0 || image_h == 0 || rect_w < 2 || rect_h < 2 {
        return None;
    }
    let screen_right = screen_x.saturating_add(image_w as i32);
    let screen_bottom = screen_y.saturating_add(image_h as i32);
    let left = rect_x.max(screen_x);
    let top = rect_y.max(screen_y);
    let right = (rect_x.saturating_add(rect_w)).min(screen_right);
    let bottom = (rect_y.saturating_add(rect_h)).min(screen_bottom);
    if right - left < 2 || bottom - top < 2 {
        return None;
    }
    Some((
        (left - screen_x) as u32,
        (top - screen_y) as u32,
        (right - left) as u32,
        (bottom - top) as u32,
    ))
}

fn parse_layout(metrics: &Value) -> Option<LayoutBox> {
    let visual = metrics.get("cssVisualViewport")?;
    let content = metrics.get("cssContentSize")?;
    let client_width = visual.get("clientWidth")?.as_f64()?;
    let client_height = visual.get("clientHeight")?.as_f64()?;
    let content_width = content.get("width")?.as_f64()?;
    let content_height = content.get("height")?.as_f64()?;
    if client_width < 1.0 || client_height < 1.0 || content_width < 1.0 || content_height < 1.0 {
        return None;
    }
    let visual_scale = visual.get("scale").and_then(Value::as_f64).unwrap_or(1.0);
    let device_width = metrics
        .pointer("/visualViewport/clientWidth")
        .and_then(Value::as_f64)
        .unwrap_or(client_width);
    Some(LayoutBox {
        client_width,
        client_height,
        visual_scale,
        content_width,
        content_height,
        device_width,
    })
}

fn base64_chars(bytes: usize) -> usize {
    bytes.div_ceil(3) * 4
}

fn is_png(bytes: &[u8]) -> bool {
    bytes.starts_with(b"\x89PNG")
}

fn is_jpeg(bytes: &[u8]) -> bool {
    bytes.starts_with(&[0xFF, 0xD8])
}

fn encode_jpeg(image: &image::DynamicImage) -> Result<Vec<u8>, String> {
    use std::io::Cursor;

    let mut buffer = Cursor::new(Vec::new());
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buffer, JPEG_QUALITY);
    encoder
        .encode_image(image)
        .map_err(|error| format!("编码 jpeg 失败：{error}"))?;
    Ok(buffer.into_inner())
}

fn encode_png(image: &image::DynamicImage) -> Result<Vec<u8>, String> {
    use std::io::Cursor;

    let mut buffer = Cursor::new(Vec::new());
    image
        .write_to(&mut buffer, image::ImageFormat::Png)
        .map_err(|error| format!("编码 png 失败：{error}"))?;
    Ok(buffer.into_inner())
}

/// jpeg 超过阈值时按长边缩小。缩完没变小，或解码失败，就留原图。
fn shrink_jpeg(bytes: Vec<u8>) -> Vec<u8> {
    if base64_chars(bytes.len()) < JPEG_TRIGGER {
        return bytes;
    }
    let Ok(decoded) = image::load_from_memory(&bytes) else {
        return bytes;
    };
    let (width, height) = fit_long_edge(decoded.width(), decoded.height(), VIEWPORT_LONG_EDGE);
    if width == decoded.width() && height == decoded.height() {
        return bytes;
    }
    let resized = decoded.resize(width, height, image::imageops::FilterType::Triangle);
    match encode_jpeg(&resized) {
        Ok(smaller) if smaller.len() < bytes.len() => smaller,
        _ => bytes,
    }
}

fn finish(bytes: Vec<u8>, format: &str, mode: &str) -> Result<Value, String> {
    let (encoded, mime) = if format == "jpeg" {
        let jpeg = if is_jpeg(&bytes) {
            bytes
        } else {
            let decoded = image::load_from_memory(&bytes)
                .map_err(|error| format!("解码截图失败：{error}"))?;
            encode_jpeg(&decoded)?
        };
        (shrink_jpeg(jpeg), "image/jpeg")
    } else if is_png(&bytes) {
        (bytes, "image/png")
    } else {
        let decoded =
            image::load_from_memory(&bytes).map_err(|error| format!("解码截图失败：{error}"))?;
        (encode_png(&decoded)?, "image/png")
    };
    Ok(json!({
        "mimeType": mime,
        "base64": intercept::base64_encode(&encoded),
        "mode": mode
    }))
}

/// 采样点的亮度几乎一样：刚 show 出来的空白帧，或一张纯色图。
///
/// 纯色页会因此不走预览、改走 CDP。CDP 仍能拍到那张纯色，只是慢一点；
/// 空白帧则不会再被当成「已经截到了」。
fn is_flat_color(image: &image::DynamicImage) -> bool {
    use image::GenericImageView;

    let width = image.width();
    let height = image.height();
    if width < 2 || height < 2 {
        return true;
    }
    let steps = 7u32;
    let mut darkest = 255u8;
    let mut lightest = 0u8;
    for row in 0..=steps {
        for column in 0..=steps {
            let x = column * (width - 1) / steps;
            let y = row * (height - 1) / steps;
            let pixel = image.get_pixel(x, y);
            let luma = (u16::from(pixel[0]) + u16::from(pixel[1]) + u16::from(pixel[2])) / 3;
            let luma = luma as u8;
            darkest = darkest.min(luma);
            lightest = lightest.max(luma);
        }
    }
    lightest.saturating_sub(darkest) <= 8
}

/// `Ok(true)` 才是能用的预览。`Ok(false)` 是空白帧，调用方应重试或改走 CDP。
fn preview_has_content(bytes: &[u8]) -> Result<bool, String> {
    let image = image::load_from_memory(bytes).map_err(|error| format!("解码预览失败：{error}"))?;
    if image.width() < 2 || image.height() < 2 {
        return Err("预览尺寸过小".into());
    }
    Ok(!is_flat_color(&image))
}

/// 截屏。`format`：`jpeg` 给模型，其余给用户（png）。`full_page` 默认关。
pub async fn screenshot(
    app: &AppHandle,
    label: &str,
    format: Option<&str>,
    full_page: bool,
) -> Result<Value, String> {
    screenshot_inner(app, label, format, full_page).await
}

/// 元素截图（jpeg）。调用方负责先撤掉 inspect 高亮。
pub async fn element_jpeg(app: &AppHandle, label: &str, rect: CssRect) -> Result<Vec<u8>, String> {
    if rect.width < 1.0 || rect.height < 1.0 {
        return Err("元素矩形为空".into());
    }
    let visual = fetch_layout(app, label)
        .await
        .map(|layout| layout.visual_scale)
        .unwrap_or(1.0);
    let scale = read_pixel_scale(app, label, visual).await;
    let clip = element_clip(rect, 2.0, scale);
    capture_cdp(app, label, "jpeg", &clip, true).await
}

async fn read_pixel_scale(app: &AppHandle, label: &str, visual_scale: f64) -> f64 {
    let channel = super::emulate::channel();
    let zoom = read_zoom_factor(app, label).unwrap_or(1.0);
    let emulation = if channel == ScaleChannel::Cdp {
        super::emulate::fit_of(label).unwrap_or(1.0)
    } else {
        1.0
    };
    pixel_scale(channel, zoom, emulation, visual_scale)
}

async fn fetch_layout(app: &AppHandle, label: &str) -> Result<LayoutBox, String> {
    let metrics = cdp::call_with_timeout(
        app,
        label,
        "Page.getLayoutMetrics",
        json!({}),
        CAPTURE_TIMEOUT,
    )
    .await?;
    parse_layout(&metrics).ok_or_else(|| "Page.getLayoutMetrics 没有视口尺寸".to_string())
}

async fn wait_paint(app: &AppHandle, label: &str) {
    let _ = cdp::call_with_timeout(
        app,
        label,
        "Runtime.evaluate",
        json!({
            "expression": PAINT_FRAMES,
            "awaitPromise": true,
            "returnByValue": true
        }),
        std::time::Duration::from_millis(200),
    )
    .await;
}

async fn screenshot_inner(
    app: &AppHandle,
    label: &str,
    format: Option<&str>,
    full_page: bool,
) -> Result<Value, String> {
    let cdp_format = if format == Some("jpeg") {
        "jpeg"
    } else {
        "png"
    };
    let revealed = super::lifecycle::reveal_for_capture(app, label);
    if revealed {
        log::info!("browser: 截图前先把视图显示出来（{label}）");
        wait_paint(app, label).await;
    }

    let outcome = capture_visible(app, label, cdp_format, full_page).await;

    if revealed {
        super::lifecycle::hide_after_capture(app, label);
    }
    outcome
}

async fn capture_visible(
    app: &AppHandle,
    label: &str,
    format: &str,
    full_page: bool,
) -> Result<Value, String> {
    let mut errors: Vec<String> = Vec::new();

    if full_page {
        // 屏幕裁切只有视口那一块，不能冒充整页成功。
        return match capture_full_page(app, label, format).await {
            Ok(bytes) => finish(bytes, format, "surface"),
            Err(error) => Err(format!(
                "整页截图失败（{label}）：{error}。屏幕裁切只有当前视口，没有把它当成整页"
            )),
        };
    } else {
        match capture_preview_retry(app, label).await {
            Ok(bytes) => return finish(bytes, format, "preview"),
            Err(error) => {
                log::warn!(
                    "browser: CapturePreview 失败（{label}），改走校正后的 CDP clip: {error}"
                );
                errors.push(format!("preview: {error}"));
            }
        }
        match capture_viewport(app, label, format).await {
            Ok(bytes) => return finish(bytes, format, "surface"),
            Err(error) => errors.push(format!("surface: {error}")),
        }
    }

    match capture_screen(app, label, format).await {
        Ok(value) => Ok(value),
        Err(error) => {
            errors.push(format!("os: {error}"));
            Err(format!(
                "截不到图（{label}）：窗口不可见或被遮挡（已尝试 preview/surface/os）—— {}",
                errors.join("；")
            ))
        }
    }
}

async fn capture_viewport(app: &AppHandle, label: &str, format: &str) -> Result<Vec<u8>, String> {
    let layout = fetch_layout(app, label).await?;
    let scale = read_pixel_scale(app, label, layout.visual_scale).await;
    let clip = viewport_clip(layout.client_width, layout.client_height, scale);
    capture_cdp(app, label, format, &clip, false).await
}

async fn capture_full_page(app: &AppHandle, label: &str, format: &str) -> Result<Vec<u8>, String> {
    let layout = fetch_layout(app, label).await?;
    let scale = read_pixel_scale(app, label, layout.visual_scale).await;
    let dpr = infer_dpr(layout.client_width, layout.device_width);
    let clip = full_page_clip(layout.content_width, layout.content_height, scale, dpr);
    let bytes = capture_cdp(app, label, format, &clip, true).await;
    // `captureBeyondViewport` 会把捏合缩放关掉。WebView2 没有 Electron 的
    // `setVisualZoomLevelLimits`，这里把 `IsPinchZoomEnabled` 关再开，并重写 ZoomFactor。
    if let Err(error) = restore_pinch_zoom(app, label) {
        log::warn!("browser: 整页截图后恢复捏合缩放失败（{label}）: {error}");
    }
    bytes
}

async fn capture_cdp(
    app: &AppHandle,
    label: &str,
    format: &str,
    clip: &ShotClip,
    beyond: bool,
) -> Result<Vec<u8>, String> {
    let mut params = json!({
        "format": format,
        "fromSurface": true,
        "captureBeyondViewport": beyond,
        "clip": {
            "x": clip.x,
            "y": clip.y,
            "width": clip.width,
            "height": clip.height,
            "scale": clip.scale
        }
    });
    if format == "jpeg" {
        params["quality"] = json!(JPEG_QUALITY);
    }
    let response = cdp::call_with_timeout(
        app,
        label,
        "Page.captureScreenshot",
        params,
        CAPTURE_TIMEOUT,
    )
    .await?;
    let data = response
        .get("data")
        .and_then(Value::as_str)
        .filter(|data| !data.is_empty())
        .ok_or_else(|| "截图响应里没有 data".to_string())?;
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data)
        .map_err(|error| format!("截图 base64 无法解码：{error}"))
}

#[cfg(windows)]
async fn capture_preview_retry(app: &AppHandle, label: &str) -> Result<Vec<u8>, String> {
    let mut last = "CapturePreview 没有返回".to_string();
    for attempt in 0..PREVIEW_ATTEMPTS {
        match capture_preview_once(app, label).await {
            Ok(bytes) => match preview_has_content(&bytes) {
                Ok(true) => return Ok(bytes),
                Ok(false) => last = "预览帧是空白，等下一帧".into(),
                Err(error) => last = error,
            },
            Err(error) => last = error,
        }
        if attempt + 1 < PREVIEW_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_millis(16)).await;
        }
    }
    Err(last)
}

#[cfg(not(windows))]
async fn capture_preview_retry(_app: &AppHandle, _label: &str) -> Result<Vec<u8>, String> {
    Err("CapturePreview 只在 Windows WebView2 上可用".into())
}

#[cfg(windows)]
async fn capture_preview_once(app: &AppHandle, label: &str) -> Result<Vec<u8>, String> {
    use std::sync::{Arc, Mutex as StdMutex};

    use tauri::Manager;
    use webview2_com::CapturePreviewCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG;
    use windows::Win32::UI::Shell::SHCreateMemStream;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;

    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<Vec<u8>, String>>();
    let pending = Arc::new(StdMutex::new(Some(sender)));

    webview
        .with_webview(move |platform| {
            let fail = |message: String| {
                if let Some(sender) = pending.lock().ok().and_then(|mut guard| guard.take()) {
                    let _ = sender.send(Err(message));
                }
            };

            let controller = platform.controller();
            let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
                fail("读不到 CoreWebView2".into());
                return;
            };
            let Some(stream) = (unsafe { SHCreateMemStream(None) }) else {
                fail("创建截图流失败".into());
                return;
            };
            let stream_read = stream.clone();
            let callback = Arc::clone(&pending);
            let handler = CapturePreviewCompletedHandler::create(Box::new(move |result| {
                let outcome = match result {
                    Ok(()) => read_stream(&stream_read),
                    Err(error) => Err(format!("CapturePreview 失败：{error}")),
                };
                if let Some(sender) = callback.lock().ok().and_then(|mut guard| guard.take()) {
                    let _ = sender.send(outcome);
                }
                Ok(())
            }));
            if let Err(error) = unsafe {
                core.CapturePreview(
                    COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                    &stream,
                    &handler,
                )
            } {
                fail(format!("发起 CapturePreview 失败：{error}"));
            }
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;

    match tokio::time::timeout(CAPTURE_TIMEOUT, receiver).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => Err("CapturePreview 被丢弃".into()),
        Err(_) => Err(format!("CapturePreview 超时（{CAPTURE_TIMEOUT:?}）")),
    }
}

#[cfg(windows)]
fn read_stream(stream: &windows::Win32::System::Com::IStream) -> Result<Vec<u8>, String> {
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};

    unsafe {
        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|error| format!("截图流回绕失败：{error}"))?;
        let mut stat = std::mem::zeroed::<STATSTG>();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|error| format!("读取截图流大小失败：{error}"))?;
        let size = stat.cbSize as usize;
        if size < 32 || size > 64 * 1024 * 1024 {
            return Err(format!("截图流大小异常：{size}"));
        }
        let mut buffer = vec![0u8; size];
        let mut read = 0u32;
        stream
            .Read(buffer.as_mut_ptr().cast(), size as u32, Some(&mut read))
            .ok()
            .map_err(|error| format!("读取截图流失败：{error}"))?;
        buffer.truncate(read as usize);
        Ok(buffer)
    }
}

#[cfg(windows)]
fn read_zoom_factor(app: &AppHandle, label: &str) -> Result<f64, String> {
    use std::sync::{Arc, Mutex as StdMutex};

    use tauri::Manager;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let slot = Arc::new(StdMutex::new(1.0_f64));
    let write = Arc::clone(&slot);
    webview
        .with_webview(move |platform| {
            let mut zoom = 0.0_f64;
            if unsafe { platform.controller().ZoomFactor(&mut zoom) }.is_ok() {
                if let Ok(mut guard) = write.lock() {
                    *guard = zoom;
                }
            }
        })
        .map_err(|error| format!("读 ZoomFactor 失败：{error}"))?;
    let zoom = *slot
        .lock()
        .map_err(|_| "读 ZoomFactor 锁失败".to_string())?;
    Ok(finite_positive(zoom, 1.0))
}

#[cfg(not(windows))]
fn read_zoom_factor(_app: &AppHandle, _label: &str) -> Result<f64, String> {
    Ok(1.0)
}

/// 整页截图会关掉捏合缩放。把开关关再开，并重写当前 `ZoomFactor`。
#[cfg(windows)]
fn restore_pinch_zoom(app: &AppHandle, label: &str) -> Result<(), String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows::core::{BOOL, Interface};

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    webview
        .with_webview(move |platform| {
            let controller = platform.controller();
            let mut zoom = 0.0_f64;
            if unsafe { controller.ZoomFactor(&mut zoom) }.is_ok() && zoom.is_finite() && zoom > 0.0
            {
                let _ = unsafe { controller.SetZoomFactor(zoom) };
            }
            let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
                return;
            };
            let Ok(settings) = (unsafe { core.Settings() }) else {
                return;
            };
            let Ok(settings) = settings.cast::<ICoreWebView2Settings5>() else {
                return;
            };
            let mut enabled = BOOL(0);
            if unsafe { settings.IsPinchZoomEnabled(&mut enabled) }.is_err() {
                return;
            }
            if enabled.as_bool() {
                let _ = unsafe { settings.SetIsPinchZoomEnabled(false) };
                let _ = unsafe { settings.SetIsPinchZoomEnabled(true) };
            }
        })
        .map_err(|error| format!("恢复捏合缩放失败：{error}"))
}

#[cfg(not(windows))]
fn restore_pinch_zoom(_app: &AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

/// 屏幕像素兜底：控件客户区所在的那一块显示器，而不是枚举出来的第一块。
#[cfg(windows)]
async fn capture_screen(app: &AppHandle, label: &str, format: &str) -> Result<Value, String> {
    let rect = read_screen_rect(app, label)?;
    let format_owned = format.to_string();
    let bytes = tauri::async_runtime::spawn_blocking(move || crop_screen(rect, &format_owned))
        .await
        .map_err(|error| format!("裁切线程异常：{error}"))??;
    Ok(bytes)
}

#[cfg(not(windows))]
async fn capture_screen(_app: &AppHandle, _label: &str, _format: &str) -> Result<Value, String> {
    Err("OS 截图只在 Windows 上可用".into())
}

#[cfg(windows)]
#[derive(Clone, Copy)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[cfg(windows)]
fn read_screen_rect(app: &AppHandle, label: &str) -> Result<ScreenRect, String> {
    use std::sync::{Arc, Mutex as StdMutex};

    use tauri::Manager;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        ClientToScreen, GetDC, GetDeviceCaps, LOGPIXELSX, ReleaseDC,
    };

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let slot: Arc<StdMutex<Result<ScreenRect, String>>> =
        Arc::new(StdMutex::new(Err("还没读到控件矩形".into())));
    let write = Arc::clone(&slot);
    webview
        .with_webview(move |platform| {
            let outcome = (|| {
                let controller = platform.controller();
                let mut bounds = RECT::default();
                unsafe { controller.Bounds(&mut bounds) }
                    .map_err(|error| format!("读控件 bounds 失败：{error}"))?;
                let mut parent = HWND::default();
                unsafe { controller.ParentWindow(&mut parent) }
                    .map_err(|error| format!("读控件父窗口失败：{error}"))?;
                if parent.0.is_null() {
                    return Err("控件没有父窗口".into());
                }
                let hdc = unsafe { GetDC(Some(parent)) };
                let dpi = unsafe { GetDeviceCaps(Some(hdc), LOGPIXELSX) };
                unsafe {
                    ReleaseDC(Some(parent), hdc);
                }
                let dip = if dpi > 0 { f64::from(dpi) / 96.0 } else { 1.0 };
                let mut origin = POINT {
                    x: (f64::from(bounds.left) * dip).round() as i32,
                    y: (f64::from(bounds.top) * dip).round() as i32,
                };
                let moved = unsafe { ClientToScreen(parent, &mut origin) };
                if !moved.as_bool() {
                    return Err("控件坐标换算到屏幕失败".into());
                }
                let width = ((f64::from(bounds.right - bounds.left) * dip).round() as i32).max(1);
                let height = ((f64::from(bounds.bottom - bounds.top) * dip).round() as i32).max(1);
                Ok(ScreenRect {
                    x: origin.x,
                    y: origin.y,
                    width,
                    height,
                })
            })();
            if let Ok(mut guard) = write.lock() {
                *guard = outcome;
            }
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;
    match slot.lock() {
        Ok(guard) => (*guard).clone(),
        Err(_) => Err("读控件矩形锁失败".into()),
    }
}

/// `screenshots` 用的是另一份 `image`，这里只拿裸 RGBA，再用本 crate 的 image 编码。
#[cfg(windows)]
fn crop_rgba_bytes(
    src_width: u32,
    pixels: &[u8],
    left: u32,
    top: u32,
    width: u32,
    height: u32,
) -> Result<image::DynamicImage, String> {
    let row_bytes = (src_width as usize).saturating_mul(4);
    let mut out = Vec::with_capacity(
        (width as usize)
            .saturating_mul(height as usize)
            .saturating_mul(4),
    );
    for row in 0..height {
        let start = (top as usize + row as usize)
            .saturating_mul(row_bytes)
            .saturating_add((left as usize).saturating_mul(4));
        let end = start.saturating_add((width as usize).saturating_mul(4));
        let Some(slice) = pixels.get(start..end) else {
            return Err("裁切超出屏幕像素".into());
        };
        out.extend_from_slice(slice);
    }
    let buffer = image::RgbaImage::from_raw(width, height, out)
        .ok_or_else(|| "裁切缓冲长度不对".to_string())?;
    Ok(image::DynamicImage::ImageRgba8(buffer))
}

#[cfg(windows)]
fn crop_screen(rect: ScreenRect, format: &str) -> Result<Value, String> {
    use screenshots::Screen;

    let screens = Screen::all().map_err(|error| format!("枚举显示器失败：{error}"))?;
    let origins: Vec<(i32, i32, u32, u32)> = screens
        .iter()
        .map(|screen| {
            let info = &screen.display_info;
            (info.x, info.y, info.width, info.height)
        })
        .collect();
    let index = find_screen(&origins, rect.x, rect.y, rect.width, rect.height)
        .ok_or_else(|| "控件不在任何一块显示器上".to_string())?;
    let screen = &screens[index];
    let image = screen
        .capture()
        .map_err(|error| format!("截取所在屏幕失败：{error}"))?;
    let (left, top, width, height) = crop_on_screen(
        screen.display_info.x,
        screen.display_info.y,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        image.width(),
        image.height(),
    )
    .ok_or_else(|| "控件矩形与所在屏幕没有交集".to_string())?;
    log::info!(
        "browser: 退到所在屏幕裁切（{}x{} @ {},{}，屏 #{index}）",
        width,
        height,
        rect.x,
        rect.y
    );
    let src_w = image.width();
    let pixels = image.into_raw();
    let cropped = crop_rgba_bytes(src_w, &pixels, left, top, width, height)?;
    let bytes = if format == "jpeg" {
        encode_jpeg(&cropped)?
    } else {
        encode_png(&cropped)?
    };
    let shrunk = if format == "jpeg" {
        shrink_jpeg(bytes)
    } else {
        bytes
    };
    let mime = if format == "jpeg" {
        "image/jpeg"
    } else {
        "image/png"
    };
    Ok(json!({
        "mimeType": mime,
        "base64": intercept::base64_encode(&shrunk),
        "mode": "os"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn viewport_clip_matches_css_when_zoom_is_one() {
        let clip = viewport_clip(800.0, 600.0, 1.0);
        assert_eq!(clip.x, 0.0);
        assert_eq!(clip.y, 0.0);
        assert_eq!(clip.width, 800.0);
        assert_eq!(clip.height, 600.0);
        assert_eq!(clip.scale, 1.0);
    }

    #[test]
    fn viewport_clip_multiplies_zoom() {
        let clip = viewport_clip(800.0, 600.0, 0.4);
        assert_eq!(clip.width, 320.0);
        assert_eq!(clip.height, 240.0);
    }

    #[test]
    fn pixel_scale_uses_only_the_active_channel() {
        let zoom = pixel_scale(ScaleChannel::Zoom, 0.4, 0.5, 1.0);
        assert!((zoom - 0.4).abs() < 1e-9);

        let cdp = pixel_scale(ScaleChannel::Cdp, 0.4, 0.5, 1.0);
        assert!((cdp - 0.5).abs() < 1e-9);

        let pinched = pixel_scale(ScaleChannel::Zoom, 0.4, 0.5, 2.0);
        assert!((pinched - 0.8).abs() < 1e-9);
    }

    #[test]
    fn full_page_scale_caps_the_long_edge_without_changing_aspect() {
        let clip = full_page_clip(2000.0, 1000.0, 1.0, 2.0);
        assert_eq!(clip.width, 2000.0);
        assert_eq!(clip.height, 1000.0);
        let output_w = clip.width * clip.scale * 2.0;
        let output_h = clip.height * clip.scale * 2.0;
        assert!(output_w <= FULL_PAGE_LONG_EDGE + 1.0);
        assert!((output_w / output_h - 2.0).abs() < 1e-9);

        let small = full_page_clip(400.0, 300.0, 1.0, 1.0);
        assert_eq!(small.scale, 1.0);
    }

    #[test]
    fn fit_long_edge_keeps_aspect() {
        assert_eq!(fit_long_edge(1000, 500, 2048), (1000, 500));
        assert_eq!(fit_long_edge(4000, 2000, 2048), (2048, 1024));
    }

    #[test]
    fn element_clip_keeps_scroll_and_scales_padding() {
        let rect = CssRect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 50.0,
            scroll_x: 30.0,
            scroll_y: 40.0,
        };
        let clip = element_clip(rect, 2.0, 1.0);
        assert_eq!(clip.x, 38.0);
        assert_eq!(clip.y, 58.0);
        assert_eq!(clip.width, 104.0);
        assert_eq!(clip.height, 54.0);

        let scaled = element_clip(rect, 2.0, 0.5);
        assert_eq!(scaled.x, 19.0);
        assert_eq!(scaled.y, 29.0);
        assert_eq!(scaled.width, 52.0);
        assert_eq!(scaled.height, 27.0);
    }

    #[test]
    fn screen_pick_uses_the_monitor_under_the_control() {
        let screens = [(0, 0, 1920, 1080), (1920, 0, 1920, 1080)];
        assert_eq!(find_screen(&screens, 2000, 100, 400, 300), Some(1));
        assert_eq!(find_screen(&screens, 10, 10, 100, 100), Some(0));
        assert_eq!(find_screen(&screens, -500, -500, 10, 10), None);
    }

    #[test]
    fn crop_stays_inside_the_chosen_screen() {
        let crop = crop_on_screen(1920, 0, 1800, 10, 400, 200, 1920, 1080).unwrap();
        assert_eq!(crop, (0, 10, 280, 200));
    }

    #[test]
    fn layout_parser_reads_visual_viewport() {
        let metrics = json!({
            "cssVisualViewport": { "clientWidth": 800.0, "clientHeight": 600.0, "scale": 1.0 },
            "cssContentSize": { "width": 800.0, "height": 2400.0 },
            "visualViewport": { "clientWidth": 1600.0, "clientHeight": 1200.0 }
        });
        let layout = parse_layout(&metrics).unwrap();
        assert_eq!(layout.client_width, 800.0);
        assert_eq!(infer_dpr(layout.client_width, layout.device_width), 2.0);
    }

    #[test]
    fn flat_preview_is_not_content() {
        let white = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            32,
            24,
            image::Rgb([250, 250, 250]),
        ));
        assert!(is_flat_color(&white));

        let mut mixed = image::RgbImage::from_pixel(32, 24, image::Rgb([250, 250, 250]));
        mixed.put_pixel(0, 0, image::Rgb([20, 20, 20]));
        assert!(!is_flat_color(&image::DynamicImage::ImageRgb8(mixed)));
    }

    #[test]
    fn tiny_jpeg_is_left_alone() {
        let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            8,
            4,
            image::Rgb([12, 34, 56]),
        ));
        let bytes = encode_jpeg(&image).unwrap();
        let shrunk = shrink_jpeg(bytes.clone());
        assert_eq!(shrunk, bytes);
    }
}
