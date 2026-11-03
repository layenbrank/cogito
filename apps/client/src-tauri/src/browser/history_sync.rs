//! SPA / 同文档导航地址同步（对齐 Chromium 地址栏）。
//!
//! `on_page_load` 只覆盖硬导航。真实浏览器地址栏还会跟同文档变更：
//! `history.pushState` / `replaceState`、后退前进到同文档条目、纯 hash/锚点。
//! Chromium 用 CDP `Page.navigatedWithinDocument` 暴露这些（`navigationType`:
//! `historyApi` | `fragment` | `other`）——与 Chrome 地址栏同源。
//!
//! WebView2 官方示例用 `SourceChanged` 刷地址栏；它对「同 URL 的 pushState」
//! 不触发，且不如 CDP 事件语义清晰。子 webview 无 IPC，不能靠页面脚本上报。
//!
//! **主 frame 过滤**：该事件也会打到 iframe；Chrome 地址栏只显示顶层 URL，
//! 必须丢掉 subframe（用 `Page.frameNavigated` 里无 `parentId` 的 frameId）。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use super::cdp;
use super::cdp_events::{self, EventSink};
use super::state::{BrowserState, NavEvent};

const MAIN_WINDOW: &str = "main";

#[derive(Default)]
struct SyncHub {
    subscribed: HashSet<String>,
    /// tab label → 当前主 frameId（硬导航后可能换新 id）
    main_frames: HashMap<String, String>,
}

fn hub() -> &'static Mutex<SyncHub> {
    static HUB: OnceLock<Mutex<SyncHub>> = OnceLock::new();
    HUB.get_or_init(|| Mutex::new(SyncHub::default()))
}

fn with_hub<T>(action: impl FnOnce(&mut SyncHub) -> T) -> T {
    let mut guard = hub()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

fn remember_main_frame(label: &str, frame_id: &str) {
    if frame_id.is_empty() {
        return;
    }
    with_hub(|hub| {
        hub.main_frames.insert(label.to_string(), frame_id.to_string());
    });
}

fn is_main_frame(label: &str, frame_id: &str) -> bool {
    with_hub(|hub| {
        match hub.main_frames.get(label) {
            Some(main) => main == frame_id,
            // 尚未学到主 frame：宁可先跟（避免首屏 pushState 丢），学到后立刻收紧
            None => true,
        }
    })
}

/// 给 tab 装同文档导航监听：**先订阅、后 `Page.enable`**。
pub fn install(app: &AppHandle, label: &str) {
    let already = with_hub(|hub| hub.subscribed.contains(label));
    if already {
        return;
    }

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let tab_for_frame = owner.clone();
        let frame_sink: EventSink = std::sync::Arc::new(move |payload: &str| {
            if let Some(frame_id) = parse_main_frame_id(payload) {
                remember_main_frame(&tab_for_frame, &frame_id);
            }
        });
        if let Err(error) =
            cdp_events::subscribe(&handle, &owner, "Page.frameNavigated", frame_sink)
        {
            log::warn!("browser: 订阅 Page.frameNavigated 失败（{owner}）: {error}");
            return;
        }

        let tab = owner.clone();
        let app_for_sink = handle.clone();
        let within_sink: EventSink = std::sync::Arc::new(move |payload: &str| {
            publish_within_document(&app_for_sink, &tab, payload);
        });
        if let Err(error) =
            cdp_events::subscribe(&handle, &owner, "Page.navigatedWithinDocument", within_sink)
        {
            log::warn!("browser: 订阅 Page.navigatedWithinDocument 失败（{owner}）: {error}");
            return;
        }

        if let Err(error) = cdp::call(&handle, &owner, "Page.enable", json!({})).await {
            log::warn!("browser: Page.enable 失败（{owner}）: {error}");
            return;
        }

        // enable 后补一次 frame tree，避免还没 frameNavigated 就发生 SPA 跳转
        if let Ok(tree) = cdp::call(&handle, &owner, "Page.getFrameTree", json!({})).await {
            if let Some(frame_id) = parse_frame_tree_main_id(&tree) {
                remember_main_frame(&owner, &frame_id);
            }
        }

        with_hub(|hub| {
            hub.subscribed.insert(owner);
        });
    });
}

/// tab 关闭时丢掉订阅标记与主 frame 缓存
pub fn forget(label: &str) {
    with_hub(|hub| {
        hub.subscribed.remove(label);
        hub.main_frames.remove(label);
    });
}

fn publish_within_document(app: &AppHandle, label: &str, payload: &str) {
    let Some(parsed) = parse_within_document(payload) else {
        return;
    };
    if parsed.url.is_empty() {
        return;
    }
    if !is_main_frame(label, &parsed.frame_id) {
        // iframe / 广告框同文档跳转：Chrome 地址栏不改顶层 URL
        return;
    }

    if let Some(browser) = app.try_state::<BrowserState>() {
        let current = browser.tab(label).map(|tab| tab.url);
        if current.as_deref() == Some(parsed.url.as_str()) {
            return;
        }
        browser.set_url_same_document(label, parsed.url.clone());
    }

    if let Err(error) = app.emit_to(
        MAIN_WINDOW,
        "browser://nav",
        NavEvent {
            label: label.to_string(),
            url: parsed.url.clone(),
            title: String::new(),
            same_document: true,
        },
    ) {
        log::warn!("browser: 同文档导航事件发送失败（{label}）: {error}");
    }

    // SPA 常同步改 title；轻量刷新一次，composer / chip 才跟得上
    let title_handle = app.clone();
    let title_label = label.to_string();
    tauri::async_runtime::spawn(async move {
        refresh_title_quiet(&title_handle, &title_label).await;
    });
}

async fn refresh_title_quiet(app: &AppHandle, label: &str) {
    let evaluated = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": "document.title || ''", "returnByValue": true }),
    )
    .await;
    let Ok(value) = evaluated else {
        return;
    };
    let title = value
        .pointer("/result/value")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let Some(browser) = app.try_state::<BrowserState>() else {
        return;
    };
    browser.set_title(label, title);
    let snapshot = browser.snapshot();
    if let Err(error) = app.emit_to(MAIN_WINDOW, "browser://tabs-changed", &snapshot) {
        log::warn!("browser: 同文档 title 广播失败（{label}）: {error}");
    }
}

struct WithinDocument {
    frame_id: String,
    url: String,
}

/// 从 CDP `Page.navigatedWithinDocument` 取出主字段。
fn parse_within_document(payload: &str) -> Option<WithinDocument> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let frame_id = value.get("frameId")?.as_str()?.to_string();
    let url = value.get("url")?.as_str()?.to_string();
    Some(WithinDocument { frame_id, url })
}

/// `Page.frameNavigated`：无 `parentId` 的是顶层 frame。
fn parse_main_frame_id(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    let frame = value.get("frame")?;
    if frame.get("parentId").and_then(Value::as_str).is_some() {
        return None;
    }
    frame.get("id").and_then(Value::as_str).map(|id| id.to_string())
}

fn parse_frame_tree_main_id(tree: &Value) -> Option<String> {
    tree.pointer("/frameTree/frame/id")
        .and_then(Value::as_str)
        .map(|id| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_navigated_within_document() {
        let parsed = parse_within_document(
            r#"{"frameId":"main-1","url":"https://app.test/settings","navigationType":"historyApi"}"#,
        )
        .expect("payload");
        assert_eq!(parsed.frame_id, "main-1");
        assert_eq!(parsed.url, "https://app.test/settings");
    }

    #[test]
    fn rejects_payload_without_url() {
        assert!(parse_within_document(r#"{"frameId":"1"}"#).is_none());
        assert!(parse_within_document("not-json").is_none());
    }

    #[test]
    fn main_frame_navigated_has_no_parent() {
        let id = parse_main_frame_id(
            r#"{"frame":{"id":"top","loaderId":"L","url":"https://app.test/","securityOrigin":"https://app.test","mimeType":"text/html"}}"#,
        );
        assert_eq!(id.as_deref(), Some("top"));
    }

    #[test]
    fn subframe_navigated_is_ignored() {
        let id = parse_main_frame_id(
            r#"{"frame":{"id":"child","parentId":"top","loaderId":"L","url":"https://ads.test/","securityOrigin":"https://ads.test","mimeType":"text/html"}}"#,
        );
        assert!(id.is_none());
    }

    #[test]
    fn frame_tree_main_id() {
        let tree = json!({
            "frameTree": {
                "frame": { "id": "root-frame", "url": "https://app.test/" },
                "childFrames": []
            }
        });
        assert_eq!(parse_frame_tree_main_id(&tree).as_deref(), Some("root-frame"));
    }
}
