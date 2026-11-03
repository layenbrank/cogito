//! SPA / 同文档导航地址同步。
//!
//! `on_page_load` 只覆盖硬导航（点链接 / 整页刷新）。`history.pushState` /
//! `replaceState` / `popstate` / hash 变更不会卸文档，地址栏会卡住。
//!
//! 这里订阅 CDP `Page.navigatedWithinDocument`（WebView2 已有 CDP 通道），
//! 把同文档 URL 变更写回 `BrowserState` 并 `emit browser://nav`。
//! 子 webview 没有 IPC，不能靠页面脚本上报。

use std::collections::HashSet;
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

/// 给 tab 装同文档导航监听：**先订阅、后 `Page.enable`**。
pub fn install(app: &AppHandle, label: &str) {
    let already = with_hub(|hub| hub.subscribed.contains(label));
    if already {
        return;
    }

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let tab = owner.clone();
        let app_for_sink = handle.clone();
        let sink: EventSink = std::sync::Arc::new(move |payload: &str| {
            publish_within_document(&app_for_sink, &tab, payload);
        });

        if let Err(error) =
            cdp_events::subscribe(&handle, &owner, "Page.navigatedWithinDocument", sink)
        {
            log::warn!("browser: 订阅 Page.navigatedWithinDocument 失败（{owner}）: {error}");
            return;
        }

        if let Err(error) = cdp::call(&handle, &owner, "Page.enable", json!({})).await {
            log::warn!("browser: Page.enable 失败（{owner}）: {error}");
            return;
        }

        with_hub(|hub| {
            hub.subscribed.insert(owner);
        });
    });
}

/// tab 关闭时丢掉订阅标记，便于 label 复用前重装（当前 label 用 UUID，主要防泄漏）
pub fn forget(label: &str) {
    with_hub(|hub| {
        hub.subscribed.remove(label);
    });
}

fn publish_within_document(app: &AppHandle, label: &str, payload: &str) {
    let Some(url) = parse_within_document_url(payload) else {
        return;
    };
    if url.is_empty() {
        return;
    }

    if let Some(browser) = app.try_state::<BrowserState>() {
        let current = browser.tab(label).map(|tab| tab.url);
        if current.as_deref() == Some(url.as_str()) {
            return;
        }
        browser.set_url_same_document(label, url.clone());
    }

    if let Err(error) = app.emit_to(
        MAIN_WINDOW,
        "browser://nav",
        NavEvent {
            label: label.to_string(),
            url: url.clone(),
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

/// 从 CDP `Page.navigatedWithinDocument` 参数里取出 url。
fn parse_within_document_url(payload: &str) -> Option<String> {
    let value: Value = serde_json::from_str(payload).ok()?;
    value
        .get("url")
        .and_then(Value::as_str)
        .map(|url| url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_navigated_within_document_url() {
        let url = parse_within_document_url(r#"{"frameId":"1","url":"https://app.test/settings"}"#);
        assert_eq!(url.as_deref(), Some("https://app.test/settings"));
    }

    #[test]
    fn rejects_payload_without_url() {
        assert!(parse_within_document_url(r#"{"frameId":"1"}"#).is_none());
        assert!(parse_within_document_url("not-json").is_none());
    }
}
