use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use super::cursor::get_cursor_position;
use super::state::ThroughState;

const POLL_INTERVAL_MS: u64 = 50;

/// Spawn the background polling task. Safe to call once during `setup`.
pub fn spawn_worker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // If the platform has no cursor backend, bail out — window stays clickable.
        if get_cursor_position().is_none() {
            tracing::info!("through: cursor backend unavailable, skipping worker");
            return;
        }

        let mut last_ignore: Option<bool> = None;
        // 代次：`ThroughState::reapply()` 之后必须丢弃缓存重算（见 state.rs 的注释）
        let mut last_generation = 0u64;

        loop {
            tokio::time::sleep(Duration::from_millis(POLL_INTERVAL_MS)).await;

            let state = match app.try_state::<ThroughState>() {
                Some(s) => s,
                None => continue,
            };

            // 期望态被外部改写（进出截屏态、探针 guard 复原）→ 作废缓存，本轮无条件重下
            let generation = state.generation();
            if generation != last_generation {
                last_generation = generation;
                last_ignore = None;
            }

            let window = match app.get_webview_window(&state.window_label) {
                Some(w) => w,
                None => {
                    // Window not yet created (or already closed). Reset cache so next
                    // appearance re-applies the correct state.
                    last_ignore = None;
                    continue;
                }
            };

            // Only act when the window is visible — avoids unnecessary IPC.
            if !window.is_visible().unwrap_or(false) {
                last_ignore = None;
                continue;
            }

            let cursor = match get_cursor_position() {
                Some(c) => c,
                None => continue,
            };

            // Use inner_* to match the webview's getBoundingClientRect() origin.
            // Convert everything to logical pixels via scale_factor, so the frontend
            // can send rects in CSS pixels (no devicePixelRatio dance required).
            let scale = window.scale_factor().unwrap_or(1.0);
            let pos = match window.inner_position() {
                Ok(p) => p.to_logical::<f64>(scale),
                Err(_) => continue,
            };
            let size = match window.inner_size() {
                Ok(s) => s.to_logical::<f64>(scale),
                Err(_) => continue,
            };

            // Cursor from GetCursorPos / CGEventSource is in physical pixels.
            let cursor_x = cursor.0 as f64 / scale;
            let cursor_y = cursor.1 as f64 / scale;

            let win_left = pos.x;
            let win_top = pos.y;
            let win_right = pos.x + size.width;
            let win_bottom = pos.y + size.height;

            let inside_window = cursor_x >= win_left
                && cursor_x < win_right
                && cursor_y >= win_top
                && cursor_y < win_bottom;

            let should_ignore = if state.is_screenshot_mode() {
                // 截屏 / 标注态要收全部指针事件；但如果 overlay 前端已经挂死
                // （心跳过期），继续钉 false 会让这个「全屏 + 透明 + 置顶」的窗口
                // 把整个桌面的点击都吃掉 —— 用户「点哪都没反应」的根因。
                // 过期即放行：宁可截屏失效，也不能让用户失去对桌面的控制。
                app.try_state::<crate::overlay::state::OverlayHealth>()
                    .map(|health| health.is_stale(crate::utils::diagnostics::now_ms()))
                    .unwrap_or(false)
            } else if !inside_window {
                // Outside window — value irrelevant, but pick a safe default.
                true
            } else {
                let local_x = (cursor_x - win_left).floor() as i32;
                let local_y = (cursor_y - win_top).floor() as i32;
                let sources = state.sources.read().await;
                let in_any = sources
                    .values()
                    .flat_map(|rects| rects.iter())
                    .any(|r| r.contains(local_x, local_y));
                !in_any
            };

            if last_ignore != Some(should_ignore) {
                if let Err(e) = window.set_ignore_cursor_events(should_ignore) {
                    tracing::warn!("through: set_ignore_cursor_events failed: {e}");
                    continue;
                }
                last_ignore = Some(should_ignore);
            }
        }
    });
}
