use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};

use crate::overlay::state::{
    OverlayHealth, OverlayMountPayload, OverlayPending, OverlayUnmountPayload, is_stale,
};
use crate::through::ThroughState;
use crate::utils::clock::now_ms;

pub const OVERLAY_LABEL: &str = "overlay";
pub const OVERLAY_URL: &str = "/overlay";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayMode {
    Idle,
    Screenshot,
}

/// 把浮层铺满主显示器（**含**任务栏区域）。
///
/// 为什么不用 `maximized`：最大化只覆盖「工作区」，任务栏那条会漏出来，
/// 截屏遮罩必须盖住整屏。所以一律按监视器的物理矩形精确摆放，
/// 并先退出最大化，避免系统把尺寸重算回工作区。
pub(crate) fn apply_bounds(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| "overlay window missing".to_string())?;
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor".to_string())?;
    let pos = monitor.position();
    let size = monitor.size();

    // 尺寸已对就不重设：常驻窗口每次截屏都重放 bounds 会闪
    let is_sized = window
        .inner_size()
        .map(|current| current.width == size.width && current.height == size.height)
        .unwrap_or(false);
    if !is_sized {
        let _ = window.unmaximize();
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
        let _ = window.set_size(PhysicalSize::new(size.width, size.height));
    }
    let _ = window.set_always_on_top(true);
    Ok(())
}

fn emit_mode(app: &AppHandle, mode: OverlayMode) {
    let _ = app.emit("overlay://mode", mode);
}

fn emit_mount(app: &AppHandle, payload: &OverlayMountPayload) {
    let _ = app.emit("overlay://mount", payload);
}

fn emit_unmount(app: &AppHandle, payload: &OverlayUnmountPayload) {
    let _ = app.emit("overlay://unmount", payload);
}

/// 重载宽限期：要求重载后超过这段时间仍没有心跳，就认为渲染进程真起不来。
const RELOAD_GRACE_MS: i64 = 6_000;

/// 页面已挂（心跳过期）→ 宿主侧重载；宽限期内仍无心跳则销毁重建窗口。
///
/// 恢复后的事件不会自动回来，所以有两道兜底：① 页面挂载后自己 `overlay:read-mode` 同步；
/// ② 这里延迟补发一次模式广播，盖住重载窗口期。挂载事件另有 take-pending 机制保障。
fn reload_stale_overlay(app: &AppHandle, reason: &str) {
    tracing::warn!("overlay 心跳过期（{reason}），重载页面");
    if let Some(health) = app.try_state::<OverlayHealth>() {
        // 从「要求重载」这一刻重新计时，下面据此判断页面是否真的活了
        health.mark_ping(now_ms());
    }

    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    if window.reload().is_err() {
        let _ = window.eval("window.location.reload()");
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // 宽限期 > 心跳间隔的余量：页面挂载时会立刻打一次心跳
        tokio::time::sleep(std::time::Duration::from_millis(8_000)).await;

        let is_dead = app
            .try_state::<OverlayHealth>()
            .map(|health| is_stale(now_ms(), health.last_ping(), RELOAD_GRACE_MS))
            .unwrap_or(false);
        if is_dead {
            tracing::warn!("overlay 重载后仍无心跳，销毁并重建窗口");
            if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
                let _ = window.destroy();
            }
            if let Err(error) = build_overlay_window(&app) {
                tracing::error!("overlay 重建失败: {error}");
            }
        }

        let mode = match app.try_state::<ThroughState>() {
            Some(through) if through.is_screenshot_mode() => OverlayMode::Screenshot,
            _ => OverlayMode::Idle,
        };
        emit_mode(&app, mode);
    });
}

/// 把浮层摆到主显示器上并保证处于可见状态（不销毁、不重建）。
///
/// 常驻映射：浮层窗口自应用启动起就一直 `show`，隐藏只走 DOM（`overlay://conceal`）。
/// 一旦 `hide()`，WebView2 会挂起渲染进程的合成，再次 `show()` 后必须等一次窗口激活
/// （用户点击）才恢复绘制 —— 表现为「按了快捷键没有遮罩、点一下才出来」。
fn ensure_overlay_visible(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return build_overlay_window(app);
    };
    // 每次都校准：分辨率/缩放/任务栏变化后仍要铺满整屏
    let _ = apply_bounds(app);
    if !window.is_visible().unwrap_or(false) {
        let _ = window.show();
        // 先按穿透显示，免得透明全屏窗在 50ms 轮询间隙里挡住桌面
        let _ = window.set_ignore_cursor_events(true);
    }
    Ok(())
}

/// Create (or show) the single always-on-top overlay window covering the primary monitor.
#[tauri::command(rename = "overlay:ensure")]
pub async fn overlay_ensure(app: AppHandle) -> Result<(), String> {
    // 渲染进程疑似已挂（白屏）：先把窗口放出来，再重载页面。
    // 注意不能早退 —— 早退会让这一次截屏完全没反应（用户得再按一次）。
    let is_stale = app
        .try_state::<OverlayHealth>()
        .map(|health| health.is_stale(now_ms()))
        .unwrap_or(false);
    ensure_overlay_visible(&app)?;
    if is_stale {
        reload_stale_overlay(&app, "overlay:ensure");
    }
    Ok(())
}

/// 创建 overlay 窗口：覆盖主显示器、透明、置顶、不进任务栏。
fn build_overlay_window(app: &AppHandle) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no primary monitor".to_string())?;
    let pos = monitor.position();
    let size = monitor.size();

    WebviewWindowBuilder::new(app, OVERLAY_LABEL, WebviewUrl::App(OVERLAY_URL.into()))
        .title("Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .maximized(false)
        .shadow(false)
        .fullscreen(false)
        .focused(false)
        .visible(true)
        .inner_size(size.width as f64, size.height as f64)
        .position(pos.x as f64, pos.y as f64)
        .build()
        .map_err(|e| format!("无法创建 overlay 窗口: {e}"))?;

    // Re-apply physical bounds in case DPI/monitor mapping differed at build time.
    apply_bounds(app)?;
    Ok(())
}

/// 退出截屏态：**不**隐藏窗口，只把交互切回穿透并广播 idle。
///
/// 窗口常驻是本模块的硬约束：hide/show 会让 WebView2 的合成挂起，下次截屏首帧
/// 要等窗口被激活才画出来。DOM 内容由前端 `overlay://conceal` / idle 自行隐藏。
#[tauri::command(rename = "overlay:hide")]
pub async fn overlay_hide(app: AppHandle) -> Result<(), String> {
    if let Some(through) = app.try_state::<ThroughState>() {
        through.set_screenshot_mode(false);
    }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_always_on_top(true);
    }
    emit_mode(&app, OverlayMode::Idle);
    Ok(())
}

/// 真正隐藏浮层窗口（只在渲染进程异常 / 应用退出这类兜底路径使用）。
#[tauri::command(rename = "overlay:park")]
pub async fn overlay_park(app: AppHandle) -> Result<(), String> {
    if let Some(through) = app.try_state::<ThroughState>() {
        through.set_screenshot_mode(false);
    }
    if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = window.hide();
    }
    emit_mode(&app, OverlayMode::Idle);
    Ok(())
}

/// Switch overlay interaction mode (`idle` | `screenshot`).
#[tauri::command(rename = "overlay:update-mode")]
pub async fn overlay_update_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let parsed = match mode.as_str() {
        "idle" => OverlayMode::Idle,
        "screenshot" => OverlayMode::Screenshot,
        other => return Err(format!("unknown overlay mode: {other}")),
    };

    if let Some(through) = app.try_state::<ThroughState>() {
        through.set_screenshot_mode(matches!(parsed, OverlayMode::Screenshot));
    }

    if matches!(parsed, OverlayMode::Screenshot) {
        overlay_ensure(app.clone()).await?;
        if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
            let _ = window.set_focus();
            let _ = window.set_ignore_cursor_events(false);
        }
    } else if let Some(window) = app.get_webview_window(OVERLAY_LABEL) {
        // idle：窗口常驻但不吃指针，立刻切回穿透（不靠 50ms 的轮询窗口）
        let _ = window.set_ignore_cursor_events(true);
    }

    emit_mode(&app, parsed);
    Ok(())
}

/// overlay 页面心跳：宿主据此判断渲染进程是否还活着。
#[tauri::command(rename = "overlay:ping")]
pub async fn overlay_ping(health: State<'_, OverlayHealth>) -> Result<(), String> {
    health.mark_ping(now_ms());
    Ok(())
}

/// 读取当前浮层模式：页面（重新）加载后主动同步一次，不只依赖事件（事件可能落在旧页面上）。
#[tauri::command(rename = "overlay:read-mode")]
pub async fn overlay_read_mode(through: State<'_, ThroughState>) -> Result<OverlayMode, String> {
    Ok(if through.is_screenshot_mode() {
        OverlayMode::Screenshot
    } else {
        OverlayMode::Idle
    })
}

/// Ensure overlay is visible and queue a panel mount (survives cold-start race).
/// 冷启动：只写 pending（前端 take-pending）；热路径：只 emit（前端已 listen）。
#[tauri::command(rename = "overlay:mount")]
pub async fn overlay_mount(
    app: AppHandle,
    payload: OverlayMountPayload,
    pending: State<'_, OverlayPending>,
) -> Result<(), String> {
    let existed = app.get_webview_window(OVERLAY_LABEL).is_some();
    {
        let mut unmount_guard = pending.unmount.lock().await;
        if unmount_guard
            .as_ref()
            .is_some_and(|p| p.magnetic_tile_id == payload.magnetic_tile_id)
        {
            *unmount_guard = None;
        }
    }
    overlay_ensure(app.clone()).await?;
    if existed {
        emit_mount(&app, &payload);
    } else {
        let mut guard = pending.mount.lock().await;
        *guard = Some(payload);
    }
    Ok(())
}

/// Remove a tile by magneticTileID.
#[tauri::command(rename = "overlay:unmount")]
pub async fn overlay_unmount(
    app: AppHandle,
    payload: OverlayUnmountPayload,
    pending: State<'_, OverlayPending>,
) -> Result<(), String> {
    let existed = app.get_webview_window(OVERLAY_LABEL).is_some();
    {
        let mut mount_guard = pending.mount.lock().await;
        if mount_guard
            .as_ref()
            .is_some_and(|p| p.magnetic_tile_id == payload.magnetic_tile_id)
        {
            *mount_guard = None;
        }
    }
    if existed {
        emit_unmount(&app, &payload);
    } else {
        let mut unmount_guard = pending.unmount.lock().await;
        *unmount_guard = Some(payload);
    }
    Ok(())
}

/// Consume queued mount payload (called by overlay shell on boot).
#[tauri::command(rename = "overlay:take-pending")]
pub async fn overlay_take_pending(
    pending: State<'_, OverlayPending>,
) -> Result<Option<OverlayMountPayload>, String> {
    let mut guard = pending.mount.lock().await;
    Ok(guard.take())
}

/// Consume queued unmount payload (called by overlay shell on boot).
#[tauri::command(rename = "overlay:take-pending-unmount")]
pub async fn overlay_take_pending_unmount(
    pending: State<'_, OverlayPending>,
) -> Result<Option<OverlayUnmountPayload>, String> {
    let mut guard = pending.unmount.lock().await;
    Ok(guard.take())
}
