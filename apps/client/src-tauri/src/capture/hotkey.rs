//! 截屏全局热键（Rust 原生注册）。
//!
//! 为什么不让前端用 `plugin-global-shortcut` 的 JS `register` 注册这个键：
//! 那条通道走 webview 的 Channel 回调 —— 主窗被 `hide()` 到托盘后渲染进程会被挂起/节流，
//! 回调延迟甚至丢失，表现就是「按了没反应，得按好几次」。这里把 **OS 注册与执行** 都放在宿主
//! 进程，JS 只负责算键位与 fallback 链（设置页的三种状态语义完全不变）。
//!
//! 契约（`capture:hotkey`）：
//! - `{ accelerator: "Alt+Q" }`                → 注册（换键时自动先撤本模块上一次注册的组合）
//! - `{ accelerator: null, release: "Alt+Q" }` → 注销指定组合
//! - 返回实际注册的组合（`null` = 当前没有注册）；失败返回 Err 供 JS 走 fallback

use std::sync::Mutex;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 当前由本模块注册的组合（换键 / 清空时据此撤旧键）
static REGISTERED: Mutex<Option<String>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
pub struct HotkeyParams {
    /// 要注册的组合；`null` / 空串表示不注册
    #[serde(default)]
    pub accelerator: Option<String>,
    /// 要注销的组合（切换 / 清空时由前端显式给出）
    #[serde(default)]
    pub release: Option<String>,
}

fn read_registered() -> Option<String> {
    REGISTERED.lock().ok().and_then(|guard| guard.clone())
}

fn write_registered(accelerator: Option<String>) {
    if let Ok(mut guard) = REGISTERED.lock() {
        *guard = accelerator;
    }
}

/// 绑定：按下即触发一次截屏，**不经过任何 webview**
fn bind(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(accelerator, move |app, _shortcut, event| {
            // OS 回调按下/抬起都会来，只认按下
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = crate::capture::command::open_capture(&app).await {
                    tracing::warn!(target: "capture", "热键触发截屏失败: {error}");
                }
            });
        })
        .map_err(|error| format!("注册全局键「{accelerator}」失败: {error}"))
}

/// 设置 / 清除截屏热键（JS 侧的 fallback 链仍由 `keyboard/global.ts` 决定）
#[tauri::command(rename = "capture:hotkey")]
pub async fn capture_set_hotkey(
    app: AppHandle,
    params: HotkeyParams,
) -> Result<Option<String>, String> {
    // 1) 显式注销（切换 / 关闭热键）
    if let Some(release) = params.release.as_deref().filter(|value| !value.is_empty()) {
        let _ = app.global_shortcut().unregister(release);
        if read_registered().as_deref() == Some(release) {
            write_registered(None);
        }
    }

    let Some(accelerator) = params
        .accelerator
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };

    // 2) 已经是这个组合：不重复注册（重复注册在插件侧会报占用）
    if read_registered().as_deref() == Some(accelerator.as_str()) {
        return Ok(Some(accelerator));
    }

    // 3) 换键：先撤本模块上一次注册的组合
    if let Some(previous) = read_registered() {
        let _ = app.global_shortcut().unregister(previous.as_str());
        write_registered(None);
    }

    bind(&app, &accelerator)?;
    write_registered(Some(accelerator.clone()));
    tracing::info!(target: "capture", "截屏热键已由宿主注册: {accelerator}");
    Ok(Some(accelerator))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_slot_round_trips() {
        // 全局静态，测试内串行使用：验证读写与清空语义
        write_registered(Some("Alt+Q".to_string()));
        assert_eq!(read_registered().as_deref(), Some("Alt+Q"));
        write_registered(None);
        assert_eq!(read_registered(), None);
    }
}
