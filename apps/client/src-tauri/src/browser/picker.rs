//! 元素拾取：对标 VS Code Integrated Browser 的 CDP Overlay 流程。
//!
//! `Overlay.setInspectMode(searchForNode)` → 系统 hover 高亮 →
//! `Overlay.inspectNodeRequested` → 抽 selector/HTML/截图 → 通知主窗。
//! 不向页面注入 DOM，任意 origin 都可用（iframe/OOPIF 首版仅主 frame）。

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

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

/// 截图前等两帧（高亮的清除也发生在渲染帧里，立刻截图会抓到旧帧）。
///
/// 页面被遮挡 / 刚从网络视图切回页面时 `requestAnimationFrame` 根本不跑 ——
/// 再兜一个 120ms 的定时器，否则 `awaitPromise` 会一直挂到 CDP 超时（10s），
/// 表现为「点了元素，十几秒才出结果」。
const QUIESCE_FRAMES: &str = "new Promise((done) => {\
    let settled = false;\
    const finish = () => { if (settled) return; settled = true; done(true); };\
    requestAnimationFrame(() => requestAnimationFrame(finish));\
    setTimeout(finish, 120);\
})";

/// 与 `agent::read` outline 同源的 path/describe，保证 selector 能直接喂 `cogito_browser_act`
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
      height: rect.height,
      // 视口坐标 + 滚动量 = Page.captureScreenshot 认的文档坐标（见 capture_clip）
      scrollX: window.scrollX || 0,
      scrollY: window.scrollY || 0
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
    /// 取矩形时的滚动量（CSS px）。`getBoundingClientRect` 是**视口**坐标，
    /// 而 `Page.captureScreenshot` 的 `clip` 是**文档**坐标 —— 不补这一段，
    /// 页面一旦滚动，截出来的就不是选中的那个元素。
    #[serde(default)]
    pub scroll_x: f64,
    #[serde(default)]
    pub scroll_y: f64,
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
    /// 已把拾取要用的那几样东西准备好（事件订阅 + `DOM` / `Overlay` 域）的 tab
    warmed: HashSet<String>,
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

/// 放掉「这次点击正在抽取」的闸门
fn release_busy(label: &str) {
    with_book(|book| {
        book.busy.remove(label);
    });
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

/// 拾取前的准备：装事件订阅 + 打开 `DOM` / `Overlay` 两个域。
///
/// 这三件事都只在**第一次**需要，而且都不是「点按钮」当下该付的账：
/// * `cdp_events::subscribe` 是**同步阻塞**的（要等主线程真装上接收器才返回）；
/// * `DOM.enable` 会让浏览器侧为整篇文档建节点索引，重页面上是几百毫秒的量级。
///
/// 以前它们和后面的三条命令一起串在 `start()` 里，点一下按钮要等 4 次串行往返，
/// 实测 1~2 秒高亮才跟手 —— 这段时间用户的 hover 全落在「按钮已按下但还没 armed」
/// 的窗口里，看起来就是「选拾取之后要等一下才可用」。现在改到 tab 建好后预热（见
/// `warm`），点击时只剩一次 `Overlay.setInspectMode`。
async fn prepare(app: &AppHandle, label: &str) -> Result<(), String> {
    ensure_subscribed(app, label)?;
    cdp::call(app, label, "DOM.enable", json!({})).await?;
    cdp::call(app, label, "Overlay.enable", json!({})).await?;
    Ok(())
}

/// tab 建好后在后台把拾取要用的东西备齐（失败不算错，`start()` 会自己重试一次）。
///
/// 预热的好处不只是「快」：`DOM.enable` 的节点索引在页面加载阶段建好，比等用户
/// 点按钮时再对着一棵已经长成的 DOM 重建要便宜得多。
pub fn warm(app: &AppHandle, label: &str) {
    if with_book(|book| book.warmed.contains(label)) {
        return;
    }
    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let started = Instant::now();
        match prepare(&handle, &owner).await {
            Ok(()) => {
                with_book(|book| {
                    book.warmed.insert(owner.clone());
                });
                log::info!(
                    "browser: 拾取预热完成（{owner}，{} ms）",
                    started.elapsed().as_millis()
                );
            }
            Err(error) => log::warn!("browser: 拾取预热失败（{owner}）: {error}"),
        }
    });
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
        release_busy(label);
        return;
    };
    let Some(backend_node_id) = value.get("backendNodeId").and_then(Value::as_u64) else {
        release_busy(label);
        return;
    };

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        let outcome = extract_and_emit(&handle, &owner, backend_node_id).await;
        if let Err(error) = outcome {
            log::warn!("browser: 元素拾取失败（{owner}）: {error}");
        }
        // busy 由 `stop` 一起摘掉：这里再置一次 false，tab 关掉后账本里会留下
        // 一行没用的记录（label 是 UUID，只会越积越多）
        let _ = stop(&handle, &owner).await;
    });
}

async fn extract_and_emit(
    app: &AppHandle,
    label: &str,
    backend_node_id: u64,
) -> Result<(), String> {
    let started = Instant::now();
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
    let text = truncate_utf8(
        data.get("text").and_then(Value::as_str).unwrap_or(""),
        TEXT_CAP,
    );
    let outer_html = truncate_utf8(
        data.get("outerHtml").and_then(Value::as_str).unwrap_or(""),
        OUTER_HTML_CAP,
    );
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
        scroll_x: rect_value
            .get("scrollX")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
        scroll_y: rect_value
            .get("scrollY")
            .and_then(Value::as_f64)
            .unwrap_or(0.0),
    };

    let screenshot = capture_clip(app, label, &rect).await;
    let elapsed = started.elapsed().as_millis();

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

    log::info!(
        "browser: 元素拾取完成（{label}，{}，{elapsed} ms，截图={}）",
        picked.tag,
        picked.screenshot.is_some()
    );

    if let Err(error) = app.emit_to(MAIN_WINDOW, EVENT_PICKED, &picked) {
        return Err(format!("发送拾取结果失败：{error}"));
    }
    Ok(())
}

/// 截图前把 Chromium 的 inspector 高亮撤掉。
///
/// `Page.captureScreenshot(fromSurface: true)` 抓的是合成后的 surface，而 hover 高亮
/// （`contentColor` 蓝填充 + `showInfo` 黑框）正是画在这一层上的 —— 不先撤，
/// 选中的元素截图会自带「正在被选中」的样式，看上去像页面本身的配色。
///
/// 撤完还要等两帧：高亮的清除同样是在渲染帧里生效的，立刻截图仍可能抓到旧帧。
async fn quiesce_overlay(app: &AppHandle, label: &str) {
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
    let _ = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({
            "expression": QUIESCE_FRAMES,
            "awaitPromise": true,
            "returnByValue": true
        }),
    )
    .await;
}

async fn capture_clip(app: &AppHandle, label: &str, rect: &PickedRect) -> Option<PickedShot> {
    if rect.width < 1.0 || rect.height < 1.0 {
        return None;
    }
    quiesce_overlay(app, label).await;
    // 略扩边，避免裁切贴边文字
    let pad = 2.0_f64;
    // `getBoundingClientRect` 给的是视口坐标，`clip` 要的是文档坐标：补上滚动量
    let x = (rect.x + rect.scroll_x - pad).max(0.0);
    let y = (rect.y + rect.scroll_y - pad).max(0.0);
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

/// 打开 inspect 模式（鼠标一 hover 就开始画高亮）
async fn arm(app: &AppHandle, label: &str) -> Result<(), String> {
    cdp::call(
        app,
        label,
        "Overlay.setInspectMode",
        json!({
            "mode": "searchForNode",
            "highlightConfig": inspect_highlight_config()
        }),
    )
    .await
    .map(|_| ())
}

/// 把「已置 active」的那一步退回去：置位之后失败不能把前端留在拾取态
fn deactivate(app: &AppHandle, label: &str) {
    with_book(|book| {
        book.active.remove(label);
    });
    release_busy(label);
    emit_active(app, label, false);
}

/// 开始拾取。
///
/// 稳态下只有**一次** CDP 往返：订阅与 `DOM.enable` / `Overlay.enable` 已经在
/// tab 建好后由 `warm()` 做完（见那里的注释），桌面态也不再多跑一趟关触摸合成。
pub async fn start(app: &AppHandle, label: &str) -> Result<(), String> {
    let started = Instant::now();

    // 兜底：预热还没轮到 / 那次就失败了（建 tab 时页面还没起来的话订阅会失败）
    if !with_book(|book| book.warmed.contains(label)) {
        prepare(app, label).await?;
        with_book(|book| {
            book.warmed.insert(label.to_string());
        });
    }

    // 设备模拟会把鼠标事件合成为 touch（`setEmitTouchEventsForMouse`），而
    // Overlay 的高亮靠真实 hover 驱动 —— 有设备才需要临时关掉合成；桌面态
    // 本来就没有这条覆盖，多跑一趟只会把「点按钮 → 跟手」又拖长一个往返。
    // 结束（`stop`）时由 `emulate::resume_mouse` 按设备重放回去。
    if emulate::has_device(app, label) {
        if let Err(error) = emulate::suspend_mouse(app, label).await {
            log::warn!("browser: 拾取前关闭触摸合成失败（{label}）: {error}");
        }
    }

    // 先置 active 再 arm：反过来的话，armed 到 active 落位之间那一下点击会被
    // `on_inspect_requested` 当成「不在拾取」丢掉（表现为第一下点了没反应）
    with_book(|book| {
        book.active.insert(label.to_string(), true);
        book.busy.remove(label);
    });

    if let Err(first_error) = arm(app, label).await {
        // 预热可能已经过期（DevTools 开过又关 / 页面被换掉）：重开一次域再试，
        // 仍失败才算真失败 —— 别让一次短暂的域重置把整个入口变成哑的
        log::warn!(
            "browser: 下发 inspect 模式失败，重开 DOM/Overlay 后重试（{label}）: {first_error}"
        );
        let retried = async {
            prepare(app, label).await?;
            with_book(|book| {
                book.warmed.insert(label.to_string());
            });
            arm(app, label).await
        }
        .await;
        if let Err(error) = retried {
            deactivate(app, label);
            return Err(error);
        }
    }

    emit_active(app, label, true);
    log::info!(
        "browser: 元素拾取就绪（{label}，{} ms）",
        started.elapsed().as_millis()
    );
    Ok(())
}

/// 结束拾取并清高亮
pub async fn stop(app: &AppHandle, label: &str) -> Result<(), String> {
    // 用 remove 而不是 insert(false)：tab 关掉之后账本里不该留下「这个 label
    // 曾经拾取过」的空记录（label 是 UUID，只会越积越多）
    let was_active = with_book(|book| book.active.remove(label).unwrap_or(false));
    release_busy(label);

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

/// tab 真的没了（关闭 / 孤儿清理）：把它在这本账里的记录全部删掉。
///
/// 不能塞进 `dispose_label`：导航也会调它，而 CDP 事件接收器挂在 webview 上、
/// 导航之后照样有效 —— 那时必须留着 `subscribed` 与 `warmed`，否则下一次拾取
/// 又要重装一遍（正是这一轮想省掉的那笔开销）。
pub fn forget(label: &str) {
    with_book(|book| {
        book.active.remove(label);
        book.busy.remove(label);
        book.subscribed.remove(label);
        book.warmed.remove(label);
    });
}

/// 当前是否在拾取
pub fn is_active(label: &str) -> bool {
    with_book(|book| *book.active.get(label).unwrap_or(&false))
}

/// 按 UTF-8 字节上限截断，落在字符边界上。
///
/// JS 侧 `slice` 按 UTF-16 code unit 裁，中文页回传后 Rust 字节长度常大于 cap；
/// 直接 `String::truncate(cap)` 会在半个码点处 panic，release 的 `panic=abort`
/// 会直接把整个进程打死。
fn truncate_utf8(value: &str, cap: usize) -> String {
    if value.len() <= cap {
        return value.to_string();
    }
    value[..value.floor_char_boundary(cap)].to_string()
}

#[cfg(test)]
mod tests {
    use super::{forget, release_busy, truncate_utf8, with_book};

    /// 账本是按 label 攒的，label 又是 UUID：一条没清干净就永远留着。
    /// `forget`（关 tab）必须四样一起摘，`release_busy` 不能把条目留成 false。
    #[test]
    fn forget_and_release_busy_leave_no_residue() {
        let label = "test-forget-label";
        with_book(|book| {
            book.active.insert(label.to_string(), true);
            book.busy.insert(label.to_string(), true);
            book.subscribed.insert(label.to_string());
            book.warmed.insert(label.to_string());
        });

        release_busy(label);
        with_book(|book| {
            assert!(
                !book.busy.contains_key(label),
                "busy 要整条摘掉，而不是留一行 false"
            );
            assert!(
                *book.active.get(label).unwrap_or(&false),
                "放闸门不该顺手改 active"
            );
        });

        forget(label);
        with_book(|book| {
            assert!(!book.active.contains_key(label));
            assert!(!book.busy.contains_key(label));
            assert!(!book.subscribed.contains(label));
            assert!(!book.warmed.contains(label));
        });
    }

    #[test]
    fn truncate_utf8_keeps_ascii_within_cap() {
        assert_eq!(truncate_utf8("hello", 5), "hello");
        assert_eq!(truncate_utf8("hello-world", 5), "hello");
    }

    #[test]
    fn truncate_utf8_does_not_split_chinese() {
        // 81 个汉字 = 243 字节；按 240 字节裁必须落到字符边界，不能 panic
        let text = "护".repeat(81);
        assert!(text.len() > 240);
        let cut = truncate_utf8(&text, 240);
        assert!(cut.len() <= 240);
        assert!(cut.is_char_boundary(cut.len()));
        assert_eq!(cut, "护".repeat(80));
    }

    #[test]
    fn truncate_utf8_empty_and_exact() {
        assert_eq!(truncate_utf8("", 10), "");
        assert_eq!(truncate_utf8("abc", 3), "abc");
        assert_eq!(truncate_utf8("护士站", 9), "护士站");
    }
}
