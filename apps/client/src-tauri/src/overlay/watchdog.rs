//! overlay 逃生通道：**不依赖前端**的心跳看门狗。
//!
//! 事故形态：截屏 / 标注浮层是「全屏 + 透明 + alwaysOnTop」，前端挂死时
//! `through/worker.rs` 仍按 `is_screenshot_mode()` 把 `ignore_cursor_events`
//! 钉成 `false`（要吃全部指针事件）—— 于是整个桌面点哪都没反应，用户只能杀进程。
//!
//! 这里用 Rust 侧看门狗兜底：每 5s 看一次心跳，过期就
//! **立刻让点击穿透 + 隐藏窗口**（桌面马上恢复可操作），再尽力重载页面。
//! 重载也救不回来时不再销毁窗口（窗口是静态创建的，销毁了不会自己回来），
//! 交给下一次 `overlay:ensure` 的 `reload_stale_overlay` 重建。
//!
//! 阈值见 `state.rs`：`PING_TIMEOUT_MS = 30s`（判定「挂了」），
//! `PARK_TIMEOUT_MS = 60s`（判定「重载也没救」）。

use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use super::state::{OverlayHealth, PARK_TIMEOUT_MS, PING_TIMEOUT_MS, is_stale};
use crate::utils::diagnostics::now_ms;

/// 看门狗轮询间隔
const TICK: Duration = Duration::from_secs(5);
/// 与 `tauri.conf.json` / `bootstrap` 里的窗口 label 一致
const OVERLAY_LABEL: &str = "overlay";

/// 启动看门狗（`setup` 里调一次）。
pub fn spawn<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        // 每次「发作」只处理一次，等窗口重新可见后复位
        let mut handled = false;
        loop {
            tokio::time::sleep(TICK).await;

            let Some(health) = app.try_state::<OverlayHealth>() else {
                continue;
            };
            let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
                handled = false;
                continue;
            };
            // 不可见 = 没在吃点击，无需干预（顺手复位）
            if !window.is_visible().unwrap_or(false) {
                handled = false;
                continue;
            }

            let last = health.last_ping();
            let now = now_ms();
            if last == 0 || !is_stale(now, last, PING_TIMEOUT_MS) {
                handled = false;
                continue;
            }
            if handled {
                continue;
            }
            handled = true;

            let silent_ms = now.saturating_sub(last);
            tracing::error!(
                target: "overlay",
                "overlay 心跳已 {silent_ms}ms 未更新（阈值 {PING_TIMEOUT_MS}ms），强制恢复点击穿透并隐藏窗口"
            );
            // 顺序要紧：先让点击穿透，再隐藏 —— 万一 hide 失败，至少桌面能点
            if let Err(error) = window.set_ignore_cursor_events(true) {
                tracing::warn!(target: "overlay", "watchdog: set_ignore_cursor_events(true) 失败: {error}");
            }
            if let Err(error) = window.hide() {
                tracing::warn!(target: "overlay", "watchdog: hide 失败: {error}");
            }

            if is_stale(now, last, PARK_TIMEOUT_MS) {
                tracing::error!(
                    target: "overlay",
                    "overlay 超过 {PARK_TIMEOUT_MS}ms 无响应，停止重载，等下一次 overlay:ensure 重建"
                );
            } else {
                // 尽力重载页面：前端进程还活着的话，这一下就能自愈
                tracing::warn!(target: "overlay", "watchdog: 重载 overlay 页面");
                if let Err(error) = window.reload() {
                    tracing::warn!(target: "overlay", "watchdog: reload 失败: {error}");
                }
            }
        }
    });
}

/// 演练入口（**仅 debug 构建**）：`COGITO_DEV_OVERLAY_STALL=<秒>` 到点把 overlay
/// 摆成「可见 + 吃全部点击 + 心跳已过期」的故障态，用来在真实二进制上验证看门狗
/// 能不能在 ~35s 内让桌面恢复可点（否则就是用户说的「点哪都没反应」）。
#[cfg(debug_assertions)]
pub fn spawn_dev_stall<R: Runtime>(app: AppHandle<R>) {
    let Some(raw) = std::env::var_os("COGITO_DEV_OVERLAY_STALL") else {
        return;
    };
    let Ok(secs) = raw.to_string_lossy().trim().parse::<u64>() else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(secs)).await;
        let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
            return;
        };
        let _ = window.show();
        let _ = window.set_ignore_cursor_events(false);
        if let Some(health) = app.try_state::<OverlayHealth>() {
            // 心跳退回到「已过期 1s」：等价于渲染进程卡死后再也不 ping
            health.mark_ping(now_ms() - PING_TIMEOUT_MS - 1_000);
        }
        tracing::warn!(
            target: "overlay",
            "演练：overlay 可见且吃点击、心跳强制过期（等看门狗兜底）"
        );
    });
}

#[cfg(test)]
mod tests {
    use super::super::state::{PARK_TIMEOUT_MS, PING_TIMEOUT_MS, is_stale};

    #[test]
    fn watchdog_thresholds_are_ordered() {
        assert!(
            PING_TIMEOUT_MS < PARK_TIMEOUT_MS,
            "先判「挂了」（30s），再判「没救了」（60s）"
        );
        // 30s 边界：29.9s 健康，30.1s 过期
        assert!(!is_stale(100_000, 100_000 - 29_900, PING_TIMEOUT_MS));
        assert!(is_stale(100_000, 100_000 - 30_100, PING_TIMEOUT_MS));
    }
}
