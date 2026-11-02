//! 元素拾取：对标 VS Code Integrated Browser 的 CDP Overlay 流程。
//!
//! `Overlay.setInspectMode(searchForNode)` → 系统 hover 高亮 →
//! `Overlay.inspectNodeRequested` → 抽 selector/HTML/截图 → 通知主窗。
//! 不向页面注入 DOM，任意 origin 都可用（iframe/OOPIF 首版仅主 frame）。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};

use super::cdp;
use super::cdp_events::{self, EventSink};
use super::emulate;

const MAIN_WINDOW: &str = "main";
const OUTER_HTML_CAP: usize = 6_000;
const TEXT_CAP: usize = 240;
const EVENT_PICKED: &str = "browser://element-picked";
const EVENT_ACTIVE: &str = "browser://element-picker-active";

/// 与 `agent::read` outline 同源的 path/describe，保证 selector 能直接喂 `app_browser_act`
const EXTRACT_FN: &str = r#"function () {
  const el = this;
  if (!el || el.nodeType !== 1) return null;
  const path = (node) => {
    const parts = [];
    let cur = node;
    while (cur && cur.nodeType === 1 && parts.length < 5) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(part + '#' + cur.id); break; }
      if (parts.length > 0 || cur !== document.body) {
        const parent = cur.parentElement;
        if (parent) {
          const index = Array.prototype.indexOf.call(parent.children, cur) + 1;
          part += ':nth-child(' + index + ')';
        }
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  const label = (
    el.innerText || el.value || el.getAttribute('aria-label') ||
    el.getAttribute('placeholder') || el.getAttribute('title') || ''
  ).trim().replace(/\s+/g, ' ');
  const rect = el.getBoundingClientRect();
  let outerHtml = '';
  try { outerHtml = el.outerHTML || ''; } catch (_) { outerHtml = ''; }
  return {
    tag: el.tagName.toLowerCase(),
    selector: path(el),
    text: label.slice(0, 240),
    outerHtml: outerHtml.slice(0, 6000),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    },
    url: location.href
  };
}"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedElement {
    pub label: String,
    pub url: String,
    pub tag: String,
    pub selector: String,
    pub text: String,
    pub outer_html: String,
    pub rect: PickedRect,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot: Option<PickedShot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedShot {
    pub mime_type: String,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickerActiveEvent {
    label: String,
    active: bool,
}

#[derive(Default)]
struct PickerBook {
    /// 正在拾取的 tab
    active: HashMap<String, bool>,
    /// 已装过 Overlay.inspectNodeRequested 接收器的 tab
    subscribed: HashSet<String>,
    /// 防止同一次点击触发多次抽取
    busy: HashMap<String, bool>,
}

fn book() -> &'static Mutex<PickerBook> {
    static BOOK: OnceLock<Mutex<PickerBook>> = OnceLock::new();
    BOOK.get_or_init(Mutex::default)
}

fn with_book<T>(action: impl FnOnce(&mut PickerBook) -> T) -> T {
    let mut guard = book()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

fn emit_active(app: &AppHandle, label: &str, active: bool) {
    if let Err(error) = app.emit_to(
        MAIN_WINDOW,
        EVENT_ACTIVE,
        PickerActiveEvent {
            label: label.to_string(),
            active,
        },
    ) {
        log::warn!("browser: 上报 picker active 失败（{label}）: {error}");
    }
}

fn inspect_highlight_config() -> Value {
    json!({
        "showInfo": true,
        "showRulers": false,
        "showStyles": false,
        "showAccessibilityInfo": false,
        "showExtensionLines": false,
        "contentColor": { "r": 111, "g": 168, "b": 220, "a": 0.55 },
        "paddingColor": { "r": 147, "g": 196, "b": 125, "a": 0.4 },
        "borderColor": { "r": 255, "g": 229, "b": 153, "a": 0.55 },
        "marginColor": { "r": 246, "g": 178, "b": 107, "a": 0.4 }
    })
}

/// 确保已订阅 `Overlay.inspectNodeRequested`（每个 tab 只装一次）
fn ensure_subscribed(app: &AppHandle, label: &str) -> Result<(), String> {
    let already = with_book(|book| book.subscribed.contains(label));
    if already {
        return Ok(());
    }

    let handle = app.clone();
    let owner = label.to_string();
    let sink: EventSink = std::sync::Arc::new(move |payload: &str| {
        on_inspect_requested(&handle, &owner, payload);
    });
    cdp_events::subscribe(app, label, "Overlay.inspectNodeRequested", sink)?;
    with_book(|book| {
        book.subscribed.insert(label.to_string());
    });
    Ok(())
}

fn on_inspect_requested(app: &AppHandle, label: &str, payload: &str) {
    let active = with_book(|book| *book.active.get(label).unwrap_or(&false));
    if !active {
        return;
    }
    let claimed = with_book(|book| {
        if *book.busy.get(label).unwrap_or(&false) {
            return false;
        }
        book.busy.insert(label.to_string(), true);
        true
    });
    if !claimed {
        return;
    }

    let Ok(value) = serde_json::from_str::<Value>(payload) else {
        with_book(|book| {
            book.busy.insert(label.to_string(), false);
        });
        return;
    };
    let Some(backend_node_id) = value.get("backendNodeId").and_then(Value::as_u64) else {
        with_book(|book| {
            book.busy.insert(label.to_string(), false);
        });
        return;
    };

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let outcome = extract_and_emit(&handle, &owner, backend_node_id).await;
        if let Err(error) = outcome {
            log::warn!("browser: 元素拾取失败（{owner}）: {error}");
        }
        let _ = stop(&handle, &owner).await;
        with_book(|book| {
            book.busy.insert(owner, false);
        });
    });
}

async fn extract_and_emit(
    app: &AppHandle,
    label: &str,
    backend_node_id: u64,
) -> Result<(), String> {
    let resolved = cdp::call(
        app,
        label,
        "DOM.resolveNode",
        json!({ "backendNodeId": backend_node_id }),
    )
    .await?;
    let object_id = resolved
        .pointer("/object/objectId")
        .and_then(Value::as_str)
        .ok_or_else(|| "DOM.resolveNode 没有 objectId".to_string())?
        .to_string();

    let called = cdp::call(
        app,
        label,
        "Runtime.callFunctionOn",
        json!({
            "objectId": object_id,
            "functionDeclaration": EXTRACT_FN,
            "returnByValue": true,
            "awaitPromise": false
        }),
    )
    .await?;
    if let Some(details) = called.get("exceptionDetails") {
        return Err(format!("抽取脚本报错：{details}"));
    }
    let data = called
        .pointer("/result/value")
        .cloned()
        .ok_or_else(|| "抽取结果为空".to_string())?;
    if data.is_null() {
        return Err("选中节点不是元素".into());
    }

    let tag = data
        .get("tag")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let selector = data
        .get("selector")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let mut text = data
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if text.len() > TEXT_CAP {
        text.truncate(TEXT_CAP);
    }
    let mut outer_html = data
        .get("outerHtml")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if outer_html.len() > OUTER_HTML_CAP {
        outer_html.truncate(OUTER_HTML_CAP);
    }
    let url = data
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let rect_value = data.get("rect").cloned().unwrap_or(json!({}));
    let rect = PickedRect {
        x: rect_value.get("x").and_then(Value::as_f64).unwrap_or(0.0),
        y: rect_value.get("y").and_then(Value::as_f64).unwrap_or(0.0),
        width: rect_value
            .get("width")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        height: rect_value
            .get("height")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    };

    let screenshot = capture_clip(app, label, &rect).await;

    let picked = PickedElement {
        label: label.to_string(),
        url,
        tag,
        selector,
        text,
        outer_html,
        rect,
        screenshot,
    };

    if let Err(error) = app.emit_to(MAIN_WINDOW, EVENT_PICKED, &picked) {
        return Err(format!("发送拾取结果失败：{error}"));
    }
    Ok(())
}

async fn capture_clip(
    app: &AppHandle,
    label: &str,
    rect: &PickedRect,
) -> Option<PickedShot> {
    if rect.width < 1.0 || rect.height < 1.0 {
        return None;
    }
    // 略扩边，避免裁切贴边文字
    let pad = 2.0_f64;
    let x = (rect.x - pad).max(0.0);
    let y = (rect.y - pad).max(0.0);
    let width = rect.width + pad * 2.0;
    let height = rect.height + pad * 2.0;

    let params = json!({
        "format": "jpeg",
        "quality": 75,
        "fromSurface": true,
        "clip": {
            "x": x,
            "y": y,
            "width": width,
            "height": height,
            "scale": 1
        }
    });

    match cdp::call(app, label, "Page.captureScreenshot", params).await {
        Ok(response) => {
            let base64 = response.get("data").and_then(Value::as_str)?;
            if base64.is_empty() {
                return None;
            }
            Some(PickedShot {
                mime_type: "image/jpeg".into(),
                base64: base64.to_string(),
            })
        }
        Err(error) => {
            log::warn!("browser: 元素截图失败（{label}）: {error}");
            None
        }
    }
}

/// 开始拾取：enable Overlay/DOM → inspect 模式
pub async fn start(app: &AppHandle, label: &str) -> Result<(), String> {
    ensure_subscribed(app, label)?;

    // 设备模拟会把鼠标事件合成为 touch（`setEmitTouchEventsForMouse`），
    // 而 Overlay 的高亮靠真实 hover 驱动 —— 先关掉合成，拾取才跟手。
    // 结束（`stop`）时由 `emulate::resume_mouse` 按设备重放回去。
    if let Err(error) = emulate::suspend_mouse(app, label).await {
        log::warn!("browser: 拾取前关闭触摸合成失败（{label}）: {error}");
    }

    cdp::call(app, label, "DOM.enable", json!({})).await?;
    cdp::call(app, label, "Overlay.enable", json!({})).await?;
    cdp::call(
        app,
        label,
        "Overlay.setInspectMode",
        json!({
            "mode": "searchForNode",
            "highlightConfig": inspect_highlight_config()
        }),
    )
    .await?;

    with_book(|book| {
        book.active.insert(label.to_string(), true);
        book.busy.insert(label.to_string(), false);
    });
    emit_active(app, label, true);
    log::info!("browser: 元素拾取开始（{label}）");
    Ok(())
}

/// 结束拾取并清高亮
pub async fn stop(app: &AppHandle, label: &str) -> Result<(), String> {
    let was_active = with_book(|book| book.active.insert(label.to_string(), false).unwrap_or(false));
    with_book(|book| {
        book.busy.insert(label.to_string(), false);
    });

    let _ = cdp::call(
        app,
        label,
        "Overlay.setInspectMode",
        json!({
            "mode": "none",
            "highlightConfig": { "showInfo": false, "showStyles": false }
        }),
    )
    .await;
    let _ = cdp::call(app, label, "Overlay.hideHighlight", json!({})).await;

    if was_active {
        // 拾取期间关掉的触摸合成在这里恢复（没有设备时是空操作）
        emulate::resume_mouse(app, label).await;
        emit_active(app, label, false);
        log::info!("browser: 元素拾取结束（{label}）");
    }
    Ok(())
}

/// tab 关闭 / 导航时收摊
pub fn dispose_label(app: &AppHandle, label: &str) {
    let active = with_book(|book| *book.active.get(label).unwrap_or(&false));
    if !active {
        with_book(|book| {
            book.active.remove(label);
            book.busy.remove(label);
        });
        return;
    }
    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let _ = stop(&handle, &owner).await;
        with_book(|book| {
            book.active.remove(&owner);
            book.busy.remove(&owner);
            // subscribed 保留：CDP 接收器卸不掉，下次 start 复用
        });
    });
}

/// 当前是否在拾取
pub fn is_active(label: &str) -> bool {
    with_book(|book| *book.active.get(label).unwrap_or(&false))
}
