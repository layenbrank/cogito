//! agent 面向浏览器 tab 的读写工具面（P0 探针 + 后续 read/act/network 的底座）。
//!
//! 这里刻意**不给** `eval`：agent 只能调下面这些固定动作。开放任意脚本等于把
//! 整个页面（含 cookie / 登录态）交出去，而且无法做输入校验。

use std::time::Duration;

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use super::cdp;
use super::intercept;
use super::lifecycle;
use super::state::BrowserState;

/// 输入类 CDP 调用（点击 / 按键）的短超时。
///
/// 设备模拟把鼠标事件合成成 touch 之后，`mousePressed` 可能等不到 WebView2 的完成回调；
/// 用全局 10s 的话每次点击都要卡满十秒才报错。点击是「这条路不通就换一条」的操作，
/// 2.5s 足够判定，也不至于让真的慢的页面被误判。
const INPUT_TIMEOUT: Duration = Duration::from_millis(2500);

/// 点击 / 悬停之后留给页面响应的时间（路由跳转、异步渲染）
const CLICK_SETTLE_MS: u64 = 250;

/// 这个 tab 是否处于**移动端**设备模拟（决定点击派发 touch 还是鼠标）。
fn is_mobile_emulation(app: &AppHandle, label: &str) -> bool {
    app.try_state::<BrowserState>()
        .and_then(|state| state.tab(label))
        .and_then(|tab| tab.device)
        .is_some_and(|device| device.mobile)
}

/// 点击的降级顺序：日志与单测靠它说清「这次可能走哪几条路」。
///
/// 模拟态首选 touch（那才是真实点按），桌面态只有鼠标；两条路都失败才交给页面内合成。
fn click_fallback_order(mobile: bool) -> &'static [&'static str] {
    if mobile {
        &["touch", "pointer", "synthetic"]
    } else {
        &["pointer", "synthetic"]
    }
}

/// `Input.dispatchTouchEvent` 的参数：单点触摸，坐标是 CSS px（与 emulated viewport 同坐标系）。
fn tap_event(kind: &str, point: Option<(f64, f64)>) -> Value {
    let points = match point {
        Some((x, y)) => json!([{
            "x": x,
            "y": y,
            "radiusX": 1.0,
            "radiusY": 1.0,
            "force": 1.0
        }]),
        None => json!([]),
    };
    json!({ "type": kind, "touchPoints": points })
}

/// 鼠标三连（move → press → release），每次调用都带短超时。
async fn dispatch_pointer(app: &AppHandle, label: &str, x: f64, y: f64) -> Result<(), String> {
    cdp::call_with_timeout(
        app,
        label,
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseMoved", "x": x, "y": y, "buttons": 0 }),
        INPUT_TIMEOUT,
    )
    .await?;
    cdp::call_with_timeout(
        app,
        label,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mousePressed", "x": x, "y": y,
            "button": "left", "buttons": 1, "clickCount": 1
        }),
        INPUT_TIMEOUT,
    )
    .await?;
    cdp::call_with_timeout(
        app,
        label,
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseReleased", "x": x, "y": y,
            "button": "left", "buttons": 0, "clickCount": 1
        }),
        INPUT_TIMEOUT,
    )
    .await
    .map(|_| ())
}

/// 真实点按，带三级降级；成功返回实际走通的通道名（`touch` / `pointer`）。
///
/// 1. 模拟态先发 `Input.dispatchTouchEvent`（真实点按）；
/// 2. 不行就**临时关掉**鼠标→touch 合成再派发鼠标事件，点完恢复（`picker` 的 `suspend_mouse` 同款）；
/// 3. 仍失败返回 `Err`，调用方落到页面内合成并回报 `mode: 'synthetic'`。
async fn dispatch_click(
    app: &AppHandle,
    label: &str,
    x: f64,
    y: f64,
    mobile: bool,
) -> Result<&'static str, String> {
    let mut failures: Vec<String> = Vec::new();

    if mobile {
        let touch = match cdp::call_with_timeout(
            app,
            label,
            "Input.dispatchTouchEvent",
            tap_event("touchStart", Some((x, y))),
            INPUT_TIMEOUT,
        )
        .await
        {
            Ok(_) => cdp::call_with_timeout(
                app,
                label,
                "Input.dispatchTouchEvent",
                tap_event("touchEnd", None),
                INPUT_TIMEOUT,
            )
            .await
            .map(|_| ()),
            Err(error) => Err(error),
        };
        match touch {
            Ok(()) => return Ok("touch"),
            Err(error) => {
                log::warn!("browser: 模拟态 touch 派发失败（{label}），改走「关合成 + 鼠标」: {error}");
                failures.push(format!("touch: {error}"));
            }
        }

        let _ = super::emulate::set_emit_touch(app, label, false).await;
        let pointer = dispatch_pointer(app, label, x, y).await;
        // 无论成败都要恢复：不恢复的话后续 hover 在模拟态下会一直按鼠标语义响应
        let _ = super::emulate::set_emit_touch(app, label, true).await;
        match pointer {
            Ok(()) => return Ok("pointer"),
            Err(error) => {
                log::warn!("browser: 关合成后鼠标派发仍失败（{label}），退到页面内合成: {error}");
                failures.push(format!("pointer: {error}"));
            }
        }
        return Err(failures.join("; "));
    }

    match dispatch_pointer(app, label, x, y).await {
        Ok(()) => Ok("pointer"),
        Err(error) => {
            log::warn!("browser: 鼠标派发失败（{label}），退到页面内合成: {error}");
            Err(format!("pointer: {error}"))
        }
    }
}

/// 动作完成后的页面状态 + `mode`（调用方靠它区分 touch / pointer / synthetic）。
async fn page_after(app: &AppHandle, label: &str, mode: &str) -> Result<Value, String> {
    let after = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({
            "expression": "({ ok: true, url: location.href, title: document.title })",
            "returnByValue": true
        }),
    )
    .await?;
    let mut value = after
        .get("result")
        .and_then(|result| result.get("value"))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(object) = value.as_object_mut() {
        object.insert("mode".into(), json!(mode));
    }
    Ok(value)
}

/// CDP `Input.dispatchKeyEvent` 用的按键描述（含组合键修饰）。
struct KeyCombo {
    key: String,
    code: String,
    vk: u32,
    /// Alt=1 Ctrl=2 Meta=4 Shift=8
    modifiers: u32,
    text: String,
}

fn key_combo(
    key: impl Into<String>,
    code: impl Into<String>,
    vk: u32,
    modifiers: u32,
    text: impl Into<String>,
) -> KeyCombo {
    let text = text.into();
    // Ctrl/Alt/Meta 按下时不要带 text/char，否则页面会当成普通输入
    let text = if modifiers & (1 | 2 | 4) != 0 {
        String::new()
    } else {
        text
    };
    KeyCombo {
        key: key.into(),
        code: code.into(),
        vk,
        modifiers,
        text,
    }
}

/// 解析 `Enter` / `Escape` / `Ctrl+A` / `Shift+Tab` 这类按键写法。
fn parse_key_combo(raw: &str) -> KeyCombo {
    let trimmed = raw.trim();
    let mut modifiers: u32 = 0;
    let mut key_token = trimmed;
    for part in trimmed.split('+') {
        let token = part.trim();
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "controlleft" | "controlright" => modifiers |= 2,
            "alt" | "altleft" | "altright" | "option" => modifiers |= 1,
            "meta" | "cmd" | "command" | "metaleft" | "metaright" | "win" | "windows" => {
                modifiers |= 4
            }
            "shift" | "shiftleft" | "shiftright" => modifiers |= 8,
            _ => key_token = token,
        }
    }

    match key_token.to_ascii_lowercase().as_str() {
        "enter" | "return" => key_combo("Enter", "Enter", 13, modifiers, "\r"),
        "escape" | "esc" => key_combo("Escape", "Escape", 27, modifiers, ""),
        "tab" => key_combo("Tab", "Tab", 9, modifiers, "\t"),
        "backspace" => key_combo("Backspace", "Backspace", 8, modifiers, ""),
        "delete" | "del" => key_combo("Delete", "Delete", 46, modifiers, ""),
        "space" | " " => key_combo(" ", "Space", 32, modifiers, " "),
        "arrowup" | "up" => key_combo("ArrowUp", "ArrowUp", 38, modifiers, ""),
        "arrowdown" | "down" => key_combo("ArrowDown", "ArrowDown", 40, modifiers, ""),
        "arrowleft" | "left" => key_combo("ArrowLeft", "ArrowLeft", 37, modifiers, ""),
        "arrowright" | "right" => key_combo("ArrowRight", "ArrowRight", 39, modifiers, ""),
        "home" => key_combo("Home", "Home", 36, modifiers, ""),
        "end" => key_combo("End", "End", 35, modifiers, ""),
        "pageup" => key_combo("PageUp", "PageUp", 33, modifiers, ""),
        "pagedown" => key_combo("PageDown", "PageDown", 34, modifiers, ""),
        _ if key_token.chars().count() == 1 => {
            let ch = key_token.chars().next().unwrap_or('a');
            let upper = ch.to_ascii_uppercase();
            if upper.is_ascii_alphabetic() {
                let key = if modifiers & 8 != 0 {
                    upper.to_string()
                } else {
                    ch.to_ascii_lowercase().to_string()
                };
                key_combo(key.clone(), format!("Key{upper}"), upper as u32, modifiers, key)
            } else if ch.is_ascii_digit() {
                key_combo(
                    ch.to_string(),
                    format!("Digit{ch}"),
                    ch as u32,
                    modifiers,
                    ch.to_string(),
                )
            } else {
                key_combo(ch.to_string(), "", ch as u32, modifiers, ch.to_string())
            }
        }
        _ => key_combo(key_token, key_token, 0, modifiers, ""),
    }
}

/// 探针：确认 CDP 通道在这台机器上确实可用。
///
/// 四项分别对应 agent 的「读 / 看网络 / 拦截改参 / 看画面」：
/// `Runtime.evaluate` / `Network.enable` / **真实拦截往返** / `Page.captureScreenshot`。
pub async fn probe(app: &AppHandle, label: &str) -> Result<Value, String> {
    let evaluate = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": "({ title: document.title, url: location.href })", "returnByValue": true }),
    )
    .await;
    let network = cdp::call(app, label, "Network.enable", json!({})).await;

    let mut probe = serde_json::Map::new();
    probe.insert("evaluate".into(), summarize(evaluate));
    probe.insert("network".into(), summarize(network));
    probe.insert("intercept".into(), probe_intercept(app, label).await);
    // 设备模拟（Emulation 域 + 缩放通道）：会短暂改页面状态，探针自己负责复原
    probe.insert("emulation".into(), super::emulate::probe(app, label).await);

    // 截图单独处理：base64 动辄几 MB，绝不能原样塞进探针结果
    let screenshot = cdp::call(
        app,
        label,
        "Page.captureScreenshot",
        json!({ "format": "png", "fromSurface": true }),
    )
    .await;
    probe.insert("screenshot".into(), summarize_screenshot(screenshot));

    Ok(Value::Object(probe))
}

/// 拦截真测：临时挂一条 mock 规则 → 从页面里 fetch 它 → 校验响应 → 还原规则。
///
/// 只验证 `Fetch.enable` 能不能调是没意义的：enable 成功不代表 `requestPaused`
/// 有人处理，而一旦处理链路断了，页面上所有请求都会卡住。所以这里跑一次真实往返。
async fn probe_intercept(app: &AppHandle, label: &str) -> Value {
    const PATTERN: &str = "/__cogito_probe__";
    const ECHO: &str = "cogito-intercept-ok";
    const TIMEOUT_MS: u32 = 3000;

    let backup = intercept::rules(label);
    let rules = vec![intercept::Rule {
        pattern: PATTERN.to_string(),
        action: "mock".to_string(),
        status: Some(200),
        body: Some(ECHO.to_string()),
        mime: Some("text/plain".to_string()),
        ..Default::default()
    }];
    if let Err(error) = intercept::set_rules(app, label, rules).await {
        return json!({ "ok": false, "error": error });
    }

    let script = format!(
        r#"Promise.race([
            fetch("{PATTERN}?probe=" + Date.now(), {{ cache: "no-store" }}).then(r => r.text()),
            new Promise(r => setTimeout(() => r("__timeout__"), {TIMEOUT_MS}))
        ])"#
    );
    let outcome = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": script, "returnByValue": true, "awaitPromise": true }),
    )
    .await;

    // 不论成败都要还原：否则探针跑完页面还挂着 Fetch.enable，每个请求都要过一次拦截
    if let Err(error) = intercept::set_rules(app, label, backup).await {
        log::warn!("browser: 探针结束后恢复拦截规则失败（{label}）: {error}");
    }

    match outcome {
        Ok(response) => {
            let echo = response
                .get("result")
                .and_then(|result| result.get("value"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            json!({ "ok": echo == ECHO, "echo": echo })
        }
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

/// 截图只报“能不能拿到”和字节数
fn summarize_screenshot(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => {
            // `Page.captureScreenshot` 直接返回 `{data}`，没有外层 `result`
            let length = value
                .get("data")
                .and_then(Value::as_str)
                .map(str::len)
                .unwrap_or(0);
            json!({ "ok": length > 0, "base64Length": length })
        }
        Err(message) => json!({ "ok": false, "error": message }),
    }
}

/// 成败都折成一句话，避免把整个 CDP 原始响应铺给调用方
fn summarize(result: Result<Value, String>) -> Value {
    match result {
        Ok(value) => json!({ "ok": true, "result": value }),
        Err(message) => json!({ "ok": false, "error": message }),
    }
}

/// 读页面：`text` 取正文，`outline` 取可交互元素的清单（agent 用来决定点哪里）；
/// `assertText` / `assertVisible` 做结构化断言（失败 `ok:false`）。
///
/// 模式都带上 `url` / `title`：agent 必须能确认“我现在在哪一页”，
/// SPA 路由变化不会触发新导航，光靠地址栏是看不出来的。
/// `limit` 只管 `outline` 的**条目数**，`max_chars` 只管 `text` 的**正文字符数**。
/// 两者曾经共用一个参数，结果 `mode=text` 只读回 60 个字符（`limit` 默认 60）。
pub async fn read(
    app: &AppHandle,
    label: &str,
    mode: &str,
    limit: usize,
    max_chars: usize,
    selector: Option<&str>,
    value: Option<&str>,
) -> Result<Value, String> {
    let expression = match mode {
        "assertText" => {
            let needle = Value::String(value.unwrap_or("").to_string()).to_string();
            let scope = Value::String(selector.unwrap_or("").to_string()).to_string();
            format!(
                r#"(() => {{
                    const needle = {needle};
                    const scope = {scope};
                    const root = scope ? document.querySelector(scope) : document.body;
                    if (!root) return {{ ok: false, reason: '断言范围无匹配元素', url: location.href }};
                    const text = (root.innerText || '').trim();
                    const ok = needle.length > 0 && text.includes(needle);
                    return {{ ok, reason: ok ? null : '未找到期望文本', needle, url: location.href, title: document.title }};
                }})()"#
            )
        }
        "assertVisible" => {
            let sel = Value::String(selector.unwrap_or("").to_string()).to_string();
            format!(
                r#"(() => {{
                    const sel = {sel};
                    if (!sel) return {{ ok: false, reason: '缺少 selector' }};
                    const el = document.querySelector(sel);
                    if (!el) return {{ ok: false, reason: '没有匹配的元素', url: location.href }};
                    const visible = typeof el.checkVisibility === 'function'
                        ? el.checkVisibility({{ checkOpacity: true, checkVisibilityCSS: true }})
                        : (el.offsetParent !== null || el.getClientRects().length > 0);
                    return {{ ok: !!visible, reason: visible ? null : '元素不可见', selector: sel, url: location.href, title: document.title }};
                }})()"#
            )
        }
        "text" => format!(
            r#"(() => {{
                const body = document.body;
                if (!body) return {{ url: location.href, title: document.title, text: '' }};
                const text = (body.innerText || '').replace(/\n{{3,}}/g, '\n\n').trim();
                return {{
                    url: location.href,
                    title: document.title,
                    text: text.slice(0, {max_chars}),
                    chars: text.length,
                    truncated: text.length > {max_chars}
                }};
            }})()"#
        ),
        _ => format!(
            r#"(() => {{
                const nodes = Array.from(
                    document.querySelectorAll('a, button, input, textarea, select, summary, [role="button"], [role="link"], [role="tab"], [contenteditable="true"]')
                );
                const isVisible = (el) => {{
                    // checkVisibility 是较新 API，隐式包含了 display/visibility/opacity/content-visibility
                    if (typeof el.checkVisibility === 'function') {{
                        return el.checkVisibility({{ checkOpacity: true, checkVisibilityCSS: true }});
                    }}
                    return el.offsetParent !== null || el.getClientRects().length > 0;
                }};
                const path = (el) => {{
                    const parts = [];
                    let node = el;
                    while (node && node.nodeType === 1 && parts.length < 5) {{
                        let part = node.tagName.toLowerCase();
                        if (node.id) {{ parts.unshift(part + '#' + node.id); break; }}
                        if (parts.length > 0 || node !== document.body) {{
                            const parent = node.parentElement;
                            if (parent) {{
                                const index = Array.prototype.indexOf.call(parent.children, node) + 1;
                                part += ':nth-child(' + index + ')';
                            }}
                        }}
                        parts.unshift(part);
                        node = node.parentElement;
                    }}
                    return parts.join(' > ');
                }};
                const describe = (el) => {{
                    const label = (
                        el.innerText || el.value || el.getAttribute('aria-label') ||
                        el.getAttribute('placeholder') || el.getAttribute('title') || ''
                    ).trim().replace(/\s+/g, ' ');
                    return {{
                        tag: el.tagName.toLowerCase(),
                        type: el.getAttribute('type') || null,
                        text: label.slice(0, 120),
                        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
                        href: el.getAttribute('href') || null,
                        selector: path(el)
                    }};
                }};

                const items = [];
                let hidden = 0;
                for (const el of nodes) {{
                    if (items.length >= {limit}) break;
                    if (!isVisible(el)) {{ hidden += 1; continue; }}
                    items.push(describe(el));
                }}
                return {{
                    url: location.href,
                    title: document.title,
                    items,
                    total: nodes.length,
                    skippedHidden: hidden
                }};
            }})()"#
        ),
    };

    let response = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
    )
    .await?;

    // CDP 把 JS 异常塞在 `exceptionDetails` 里，不当成 Err，这里提出来
    if let Some(details) = response.get("exceptionDetails") {
        return Err(format!("页面脚本报错：{details}"));
    }
    Ok(response
        .get("result")
        .and_then(|result| result.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}

/// 动页面：只允许固定动作 + 一个选择器。
pub async fn act(
    app: &AppHandle,
    label: &str,
    action: &str,
    selector: &str,
    value: Option<&str>,
) -> Result<Value, String> {
    // 重载后留给页面的落定时间：CDP 的 `Page.reload` 是异步的，
    // 立刻回去读 `readyState` 只会拿到旧文档。
    const RELOAD_SETTLE_MS: u64 = 600;

    if !matches!(
        action,
        "click" | "type" | "press" | "scroll" | "hover" | "reload" | "select"
    ) {
        return Err(format!("不支持的动作：{action}"));
    }

    // 重载走 CDP：JS 里 `location.reload()` 可能被页面自己的 CSP/路由拦，
    // 而在页面内合成 F5 / Ctrl+R 根本不会触发浏览器级刷新。
    if action == "reload" {
        let ignore_cache = matches!(value, Some("hard") | Some("true"));
        cdp::call(
            app,
            label,
            "Page.reload",
            json!({ "ignoreCache": ignore_cache }),
        )
        .await?;
        tokio::time::sleep(std::time::Duration::from_millis(RELOAD_SETTLE_MS)).await;
        let state = cdp::call(
            app,
            label,
            "Runtime.evaluate",
            json!({
                "expression": "({ readyState: document.readyState, url: location.href, title: document.title })",
                "returnByValue": true
            }),
        )
        .await?;
        return Ok(json!({
            "action": "reload",
            "ignoreCache": ignore_cache,
            "page": state
                .get("result")
                .and_then(|result| result.get("value"))
                .cloned()
                .unwrap_or(Value::Null)
        }));
    }

    // 选择器直接内联进脚本 → 用 JSON 序列化兜住引号与反斜杠
    // click / hover 优先走 **CDP 真实输入事件**：
    // `el.click()` 只会派发一个 click，没有 pointerdown / pointerup，也没有命中测试 ——
    // base-ui / Radix / 拖拽把手 / canvas 这类只认 pointer 事件的组件（本 app 自己的
    // 下拉、菜单就是）在合成 click 下不响应，agent 走交互链路时会表现为「点不动」。
    //
    // 设备模拟下鼠标事件会被合成为 touch，`mousePressed` 可能等不到回调（CDP 10s 超时）：
    // 所以 click 走 `dispatch_click` 的三级降级（模拟态 touch → 关合成 + 鼠标 → 页面内合成），
    // 每一步都带 2.5s 短超时，返回值用 `mode` 说明实际走通的通道。
    // 拿不到几何信息（隐藏元素 / 未布局）时同样落到页面内合成。
    if action == "click" || action == "hover" {
        let rect_expr = format!(
            r#"(() => {{
                const el = document.querySelector({selector_json});
                if (!el) return null;
                el.scrollIntoView({{ block: 'center', inline: 'center' }});
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return null;
                return {{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }};
            }})()"#,
            selector_json = Value::String(selector.to_string()).to_string(),
        );
        let measured = cdp::call(
            app,
            label,
            "Runtime.evaluate",
            json!({ "expression": rect_expr, "returnByValue": true }),
        )
        .await?;
        let point = measured
            .get("result")
            .and_then(|result| result.get("value"))
            .cloned()
            .unwrap_or(Value::Null);
        let x = point.get("x").and_then(Value::as_f64);
        let y = point.get("y").and_then(Value::as_f64);

        if let (Some(x), Some(y)) = (x, y) {
            let mobile = is_mobile_emulation(app, label);
            if action == "hover" {
                let hover = cdp::call_with_timeout(
                    app,
                    label,
                    "Input.dispatchMouseEvent",
                    json!({ "type": "mouseMoved", "x": x, "y": y, "buttons": 0 }),
                    INPUT_TIMEOUT,
                )
                .await;
                match hover {
                    Ok(_) => {
                        tokio::time::sleep(std::time::Duration::from_millis(CLICK_SETTLE_MS))
                            .await;
                        return page_after(app, label, "pointer").await;
                    }
                    Err(error) => log::warn!(
                        "browser: hover 的鼠标派发失败（{label}，mobile={mobile}），退到页面内合成: {error}"
                    ),
                }
            } else {
                match dispatch_click(app, label, x, y, mobile).await {
                    Ok(mode) => {
                        tokio::time::sleep(std::time::Duration::from_millis(CLICK_SETTLE_MS))
                            .await;
                        return page_after(app, label, mode).await;
                    }
                    Err(error) => log::warn!(
                        "browser: 真实点按全部失败（{label}，mobile={mobile}：{}），退到页面内合成: {error}",
                        click_fallback_order(mobile).join(" → ")
                    ),
                }
            }
        }
    }


    // 按键走 CDP 的**真实键盘事件**：页面内合成的 KeyboardEvent 不会触发浏览器默认行为，
    // 于是「Enter 提交表单 / Escape 关弹层 / Tab 换焦点 / 方向键走 combobox」全都点不动。
    // value 支持组合键写法：`Enter`、`Escape`、`Tab`、`Ctrl+A`、`Shift+Tab`。
    if action == "press" {
        if !selector.trim().is_empty() {
            let focus_expr = format!(
                "(() => {{ const el = document.querySelector({}); if (el) el.focus(); return !!el; }})()",
                Value::String(selector.to_string())
            );
            cdp::call(
                app,
                label,
                "Runtime.evaluate",
                json!({ "expression": focus_expr, "returnByValue": true }),
            )
            .await?;
        }
        let combo = parse_key_combo(value.unwrap_or("Enter"));
        let mut down = json!({
            "type": "keyDown",
            "key": &combo.key,
            "code": &combo.code,
            "windowsVirtualKeyCode": combo.vk,
            "nativeVirtualKeyCode": combo.vk,
            "modifiers": combo.modifiers
        });
        if !combo.text.is_empty() {
            down["text"] = json!(&combo.text);
            down["unmodifiedText"] = json!(&combo.text);
        }
        let key_up = json!({
            "type": "keyUp",
            "key": &combo.key,
            "code": &combo.code,
            "windowsVirtualKeyCode": combo.vk,
            "nativeVirtualKeyCode": combo.vk,
            "modifiers": combo.modifiers
        });
        let delivered = match cdp::call_with_timeout(
            app,
            label,
            "Input.dispatchKeyEvent",
            down,
            INPUT_TIMEOUT,
        )
        .await
        {
            Ok(_) => cdp::call_with_timeout(
                app,
                label,
                "Input.dispatchKeyEvent",
                key_up,
                INPUT_TIMEOUT,
            )
            .await
            .map(|_| ()),
            Err(error) => Err(error),
        };
        if let Err(error) = delivered {
            // 键盘派发失败（模拟态偶发）不再直接抛错：落到页面内合成 KeyboardEvent，
            // 至少能触发 React onKeyDown 这类监听（浏览器默认行为拿不到，日志里能看出来）。
            log::warn!("browser: 真实键盘派发失败（{label}），退到页面内合成: {error}");
        } else {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            let after = cdp::call(
                app,
                label,
                "Runtime.evaluate",
                json!({
                    "expression": "({ ok: true, mode: 'keyboard', url: location.href, title: document.title, active: document.activeElement ? document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '') : null })",
                    "returnByValue": true
                }),
            )
            .await?;
            return Ok(after
                .get("result")
                .and_then(|result| result.get("value"))
                .cloned()
                .unwrap_or(Value::Null));
        }
    }

    let selector_json = Value::String(selector.to_string()).to_string();
    let value_json = match value {
        Some(text) => Value::String(text.to_string()).to_string(),
        None => "null".to_string(),
    };

    let expression = format!(
        r#"(() => {{
            const value = {value_json};

            // scroll：不传 selector 时滚整页；传了就滚目标所在的**最近可滚动祖先** ——
            // H5 页面常用 inner scroll container，只滚 window 的话看上去「滚不动」。
            if ({action_json} === 'scroll') {{
                const delta = Number(value) || 600;
                const sel = {selector_json};
                const target = sel ? document.querySelector(sel) : null;
                if (target) {{
                    target.scrollIntoView({{ block: 'center', inline: 'nearest' }});
                    let node = target;
                    let scrolled = false;
                    while (node && node !== document.body) {{
                        const style = getComputedStyle(node);
                        const scrollable =
                            /(auto|scroll|overlay)/.test(style.overflowY) &&
                            node.scrollHeight > node.clientHeight + 1;
                        if (scrollable) {{
                            node.scrollTop += delta;
                            scrolled = true;
                            break;
                        }}
                        node = node.parentElement;
                    }}
                    if (!scrolled) window.scrollBy(0, delta);
                }} else {{
                    window.scrollBy(0, delta);
                }}
            }} else {{
                const el = document.querySelector({selector_json});
                if (!el) return {{ ok: false, reason: '没有匹配的元素' }};
                switch ({action_json}) {{
                    case 'click':
                        el.click();
                        break;
                    case 'hover':
                        el.dispatchEvent(new PointerEvent('pointerover', {{ bubbles: true }}));
                        el.dispatchEvent(new PointerEvent('pointerenter', {{ bubbles: false }}));
                        el.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
                        el.dispatchEvent(new MouseEvent('mousemove', {{ bubbles: true }}));
                        break;
                    case 'press': {{
                        const key = value || 'Enter';
                        el.focus();
                        el.dispatchEvent(new KeyboardEvent('keydown', {{ key, bubbles: true }}));
                        el.dispatchEvent(new KeyboardEvent('keypress', {{ key, bubbles: true }}));
                        el.dispatchEvent(new KeyboardEvent('keyup', {{ key, bubbles: true }}));
                        break;
                    }}
                    case 'type': {{
                        el.focus();
                        const next = value == null ? '' : String(value);
                        // React / Vue 的受控 input 会拦住 `el.value = x`，只能用原型上的
                        // 原生 setter 写，再手动派发 input/change 才能让框架收到
                        const proto = Object.getPrototypeOf(el);
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        if (setter) setter.call(el, next);
                        else if ('value' in el) el.value = next;
                        else el.textContent = next;
                        el.dispatchEvent(new InputEvent('input', {{ bubbles: true, data: next }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        break;
                    }}
                    case 'select': {{
                        if (el.tagName !== 'SELECT') return {{ ok: false, reason: '不是 select 元素' }};
                        const next = value == null ? '' : String(value);
                        let matched = false;
                        for (const opt of Array.from(el.options)) {{
                            if (opt.value === next || opt.textContent.trim() === next) {{
                                el.value = opt.value;
                                matched = true;
                                break;
                            }}
                        }}
                        if (!matched) return {{ ok: false, reason: '没有匹配的 option' }};
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        break;
                    }}
                }}
            }}

            // 点完 / 输完页面往往异步刷新，给一帧多一点再回来；不让 agent 自己去竞速
            return new Promise((resolve) => {{
                setTimeout(() => resolve({{ ok: true, mode: 'synthetic', url: location.href, title: document.title }}), 250);
            }});
        }})()"#,
        action_json = Value::String(action.to_string()).to_string(),
    );

    let response = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true, "awaitPromise": true }),
    )
    .await?;
    if let Some(details) = response.get("exceptionDetails") {
        return Err(format!("页面脚本报错：{details}"));
    }
    Ok(response
        .get("result")
        .and_then(|result| result.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}

/// 等待条件：selector 出现/可见/可点，或短窗口 networkIdle。
pub async fn wait(
    app: &AppHandle,
    label: &str,
    condition: &str,
    selector: Option<&str>,
    timeout_ms: u64,
) -> Result<Value, String> {
    let timeout = timeout_ms.clamp(100, 60_000);
    let poll_ms: u64 = 200;
    let started = std::time::Instant::now();

    if condition == "networkIdle" {
        // 简化：连续两轮 poll 内无新文档请求即视为 idle（CDP Network 完整计数成本高）
        let mut quiet_rounds = 0u32;
        while started.elapsed().as_millis() < u128::from(timeout) {
            let busy = cdp::call(
                app,
                label,
                "Runtime.evaluate",
                json!({
                    "expression": "document.readyState !== 'complete'",
                    "returnByValue": true
                }),
            )
            .await?;
            let is_busy = busy
                .get("result")
                .and_then(|result| result.get("value"))
                .and_then(Value::as_bool)
                .unwrap_or(true);
            if is_busy {
                quiet_rounds = 0;
            } else {
                quiet_rounds += 1;
                if quiet_rounds >= 2 {
                    return Ok(json!({
                        "ok": true,
                        "condition": "networkIdle",
                        "elapsedMs": started.elapsed().as_millis() as u64
                    }));
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
        }
        return Ok(json!({
            "ok": false,
            "reason": "等待 networkIdle 超时",
            "condition": "networkIdle",
            "elapsedMs": started.elapsed().as_millis() as u64
        }));
    }

    let sel = selector.unwrap_or("").trim();
    if sel.is_empty() {
        return Err("等待 selector/visible/clickable 时需要 selector".to_string());
    }
    let sel_json = Value::String(sel.to_string()).to_string();
    let cond_json = Value::String(condition.to_string()).to_string();

    while started.elapsed().as_millis() < u128::from(timeout) {
        let expression = format!(
            r#"(() => {{
                const el = document.querySelector({sel_json});
                if (!el) return {{ ok: false }};
                const visible = typeof el.checkVisibility === 'function'
                    ? el.checkVisibility({{ checkOpacity: true, checkVisibilityCSS: true }})
                    : (el.offsetParent !== null || el.getClientRects().length > 0);
                if ({cond_json} === 'selector') return {{ ok: true }};
                if ({cond_json} === 'visible') return {{ ok: !!visible }};
                if ({cond_json} === 'clickable') {{
                    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
                    return {{ ok: !!visible && !disabled }};
                }}
                return {{ ok: !!visible }};
            }})()"#
        );
        let response = cdp::call(
            app,
            label,
            "Runtime.evaluate",
            json!({ "expression": expression, "returnByValue": true }),
        )
        .await?;
        let ok = response
            .get("result")
            .and_then(|result| result.get("value"))
            .and_then(|value| value.get("ok"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if ok {
            return Ok(json!({
                "ok": true,
                "condition": condition,
                "selector": sel,
                "elapsedMs": started.elapsed().as_millis() as u64
            }));
        }
        tokio::time::sleep(std::time::Duration::from_millis(poll_ms)).await;
    }

    Ok(json!({
        "ok": false,
        "reason": format!("等待 {condition} 超时"),
        "condition": condition,
        "selector": sel,
        "elapsedMs": started.elapsed().as_millis() as u64
    }))
}

/// 截图的两条通道，按顺序尝试：
/// 1. `fromSurface: true` —— 合成面（滚动之后看到的真实画面）；
/// 2. `fromSurface: false` —— 视图面。
///
/// 为什么需要两条：窗口不可见 / webview 被 `hide()` 时合成器可能不再出帧，
/// `fromSurface: true` 的调用会**等不到完成回调**（WebView2 不回包，只有超时）。
/// 视图面在同样的状态下往往还能立刻拿到一张（可能是空白），而空图会再走一次
/// `reveal_for_capture` 重拍 —— 有图 / 有明确原因，都好过「先等十秒再报错」。
fn screenshot_channels() -> [bool; 2] {
    [true, false]
}

/// `Page.captureScreenshot` 的参数：`fromSurface` 决定截合成面还是视图面。
fn screenshot_params(format: &str, from_surface: bool) -> Value {
    let mut params = json!({ "format": format, "fromSurface": from_surface });
    // quality 只对 jpeg 有意义，png 带上它反而会被协议拒绝
    if format == "jpeg" {
        params["quality"] = json!(SCREENSHOT_JPEG_QUALITY);
    }
    params
}

/// 单次截图的上限。比全局 10s 短：两条通道加起来仍是一次工具调用的合理等待时间，
/// 也不会在窗口不可见时把调用方挂满十秒（那正是上一版的观感问题）。
const SCREENSHOT_TIMEOUT: Duration = Duration::from_millis(4000);

/// jpeg 质量：给模型看够用，体积比 png 小一个量级。
const SCREENSHOT_JPEG_QUALITY: u8 = 75;

/// 截屏：`Page.captureScreenshot` 拿 base64，返回原始 base64 + mime。
///
/// 不返回 data URL：同一份 base64 再拼一遍会让 JSON 体积翻倍。需要 data URL 时
/// 调用方（前端 / 面板）自己拼一行就行。
///
/// `format`：`jpeg` 给模型看（体积小很多，样式判断够用），`png` 给用户看。
/// 通道顺序见 `screenshot_channels()`：合成面优先，超时 / 报错再退到视图面，
/// 两条都不行时把各自的失败原因一起带回去（便于区分「没画面」和「没权限」）。
pub async fn screenshot(
    app: &AppHandle,
    label: &str,
    format: Option<&str>,
) -> Result<Value, String> {
    let (cdp_format, mime_type) = match format {
        Some("jpeg") => ("jpeg", "image/jpeg"),
        _ => ("png", "image/png"),
    };

    let mut errors: Vec<String> = Vec::new();
    let mut response = Value::Null;
    let mut channel_mode = "surface";
    // 拍之前先亮：WebView2 在隐藏态根本不出帧，`fromSurface` 通道会白等满 4s 才超时。
    // 亮不起来也不算错（可能被别的窗口压着），每条通道自己还有「空图再亮一次」的兜底。
    let pre_revealed = lifecycle::reveal_for_capture(app, label);
    if pre_revealed {
        log::info!("browser: 截图前先把视图显示出来（{label}）");
    }
    for (index, from_surface) in screenshot_channels().into_iter().enumerate() {
        let params = screenshot_params(cdp_format, from_surface);
        let mut outcome = cdp::call_with_timeout(
            app,
            label,
            "Page.captureScreenshot",
            params.clone(),
            SCREENSHOT_TIMEOUT,
        )
        .await;

        // 空图不是报错：webview 隐藏（切在聊天视图 / 浮层让位）时 WebView2 会返回空对象。
        // 临时显示一下再拍，拍完收回 —— 否则 agent 在聊天视图下永远截不到图。
        let empty = matches!(&outcome, Ok(value) if value.get("data").is_none());
        if empty && !pre_revealed && lifecycle::reveal_for_capture(app, label) {
            log::info!("browser: 截图拿到空数据，临时显示后重试（{label}）");
            outcome = cdp::call_with_timeout(
                app,
                label,
                "Page.captureScreenshot",
                params,
                SCREENSHOT_TIMEOUT,
            )
            .await;
            lifecycle::hide_after_capture(app, label);
        }

        match outcome {
            Ok(value) if value.get("data").is_some() => {
                channel_mode = if from_surface { "surface" } else { "view" };
                if index > 0 {
                    log::info!(
                        "browser: 截图从第 {} 条通道拿到画面（{label}，fromSurface={from_surface}）",
                        index + 1
                    );
                }
                response = value;
                break;
            }
            Ok(_) => errors.push(format!("fromSurface={from_surface}: 响应里没有 data")),
            Err(error) => {
                log::warn!(
                    "browser: 截图 fromSurface={from_surface} 失败（{label}），换下一条通道: {error}"
                );
                errors.push(format!("fromSurface={from_surface}: {error}"));
            }
        }
    }

    if response.get("data").is_none() {
        // CDP 两条通道都没画面：退到 OS 级兜底（屏幕像素），拿到就不算失败
        match os_capture(app, label, cdp_format).await {
            Ok(value) => {
                if pre_revealed {
                    lifecycle::hide_after_capture(app, label);
                }
                return Ok(value);
            }
            Err(error) => errors.push(format!("os: {error}")),
        }
        if pre_revealed {
            lifecycle::hide_after_capture(app, label);
        }
        return Err(format!(
            "截不到图（{label}）：窗口不可见或被遮挡（已尝试 surface/view/os）—— {}",
            errors.join("；")
        ));
    }

    let data = response
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            log::warn!("browser: 截图响应里没有 data（{label}）: {response}");
            "截图响应里没有 data".to_string()
        })?
        .to_string();

    let data = shrink_oversized(app, label, cdp_format, data).await;
    if pre_revealed {
        lifecycle::hide_after_capture(app, label);
    }

    Ok(json!({ "mimeType": mime_type, "base64": data, "mode": channel_mode }))
}

/// OS 级兜底：CDP 两条通道都拿不到画面时，从屏幕像素里裁一块。
///
/// 走的是 `capture` 模块同一条 corex IPC（`capture/screenshot` → 主屏 PNG），再按浏览器面板的
/// 客户区矩形裁切 —— 不自己写 BitBlt：corex 已经处理了多显示器 / DPI / 缩放，进程里再加一套
/// GDI 只会多一份平台特例。截完立刻删掉整屏 png，不占缓存。
///
/// 代价：拍到的是**屏幕上真实的那一块**，被别的窗口压着就会把遮挡也拍进来，
/// 所以返回值带 `mode: "os"`，调用方据此知道这不是合成画面。
async fn os_capture(app: &AppHandle, label: &str, format: &str) -> Result<Value, String> {
    let snapshot = tauri::Manager::state::<crate::browser::state::BrowserState>(app).snapshot();
    let layout = snapshot.layout;
    if !layout.has_been_laid_out || layout.width < 2.0 || layout.height < 2.0 {
        return Err("面板还没布局，无法确定裁切区域".to_string());
    }
    // 主窗口 label 来自 tauri.conf.json（子 webview 的客户区坐标相对它）
    let window = tauri::Manager::get_webview_window(app, "main")
        .ok_or_else(|| "没有主窗口".to_string())?;
    let origin = window
        .inner_position()
        .map_err(|error| format!("读窗口位置失败：{error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("读窗口缩放失败：{error}"))?;

    // 整屏 png 落到 agent 缓存目录（会话级，不脏工作区）
    let dir = crate::utils::agent_cache::session_dir("browser-os-capture")?;
    let target = dir.join(format!("shot-{}.png", crate::utils::clock::now_ms()));
    let to = target.display().to_string();
    let response = tauri::async_runtime::spawn_blocking(move || {
        crate::utils::ipc::invoke_with(
            "capture",
            Some("screenshot"),
            json!({ "to": to, "format": "png" }),
        )
    })
    .await
    .map_err(|error| format!("截图线程异常：{error}"))??;
    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| "OS 截图失败（corex 未就绪？）".to_string()));
    }
    let path = response
        .path
        .unwrap_or_else(|| target.display().to_string());

    let (left, top, width, height) = (
        origin.x as f64 + layout.x * scale,
        origin.y as f64 + layout.y * scale,
        layout.width * scale,
        layout.height * scale,
    );
    log::info!(
        "browser: CDP 截图失败，退到 OS 客户区兜底（{label}，{:.0}x{:.0} @ {:.0},{:.0}）",
        width, height, left, top
    );
    let want_jpeg = format == "jpeg";
    let (bytes, mime_type) = tauri::async_runtime::spawn_blocking(
        move || -> Result<(Vec<u8>, &'static str), String> {
            let decoded = image::ImageReader::open(&path)
                .map_err(|error| format!("打开整屏截图失败：{error}"))?
                .decode()
                .map_err(|error| format!("解码整屏截图失败：{error}"))?;
            // 读进内存就删：这是纯中转文件
            let _ = std::fs::remove_file(&path);
            let max_width = decoded.width();
            let max_height = decoded.height();
            let x0 = (left.max(0.0) as u32).min(max_width.saturating_sub(1));
            let y0 = (top.max(0.0) as u32).min(max_height.saturating_sub(1));
            let w = (width.max(1.0) as u32)
                .min(max_width.saturating_sub(x0))
                .max(1);
            let h = (height.max(1.0) as u32)
                .min(max_height.saturating_sub(y0))
                .max(1);
            let (image_format, mime) = if want_jpeg {
                (image::ImageFormat::Jpeg, "image/jpeg")
            } else {
                (image::ImageFormat::Png, "image/png")
            };
            let mut buffer = std::io::Cursor::new(Vec::new());
            decoded
                .crop_imm(x0, y0, w, h)
                .write_to(&mut buffer, image_format)
                .map_err(|error| format!("编码裁切结果失败：{error}"))?;
            Ok((buffer.into_inner(), mime))
        },
    )
    .await
    .map_err(|error| format!("裁切线程异常：{error}"))??;

    Ok(json!({
        "mimeType": mime_type,
        "base64": intercept::base64_encode(&bytes),
        "mode": "os"
    }))
}

/// 设备模拟（dpr 到 3）会让同一屏的 jpeg 大三四倍。超过阈值时按 CSS px 再拍一张，
/// **只有真的更小才采用**：`clip.scale` 的含义在不同 WebView2 版本上不完全一致，
/// 用“体积对不对”当判据，比猜协议语义安全（最坏情况就是留着原来那张）。
async fn shrink_oversized(app: &AppHandle, label: &str, format: &str, data: String) -> String {
    /// 触发二次截图的体积阈值（base64 字符数，约 300KB 原图）
    const TRIGGER: usize = 400_000;

    if format != "jpeg" || data.len() < TRIGGER {
        return data;
    }
    let Ok(metrics) = super::emulate::readback(app, label).await else {
        return data;
    };
    let (Some(width), Some(height), Some(dpr)) = (
        metrics.get("innerWidth").and_then(Value::as_f64),
        metrics.get("innerHeight").and_then(Value::as_f64),
        metrics.get("dpr").and_then(Value::as_f64),
    ) else {
        return data;
    };
    if width < 1.0 || height < 1.0 || dpr <= 1.5 {
        return data;
    }

    let params = json!({
        "format": "jpeg",
        "quality": 75,
        "fromSurface": true,
        "clip": { "x": 0.0, "y": 0.0, "width": width, "height": height, "scale": 1.0 / dpr }
    });
    let Ok(smaller) = cdp::call_with_timeout(
        app,
        label,
        "Page.captureScreenshot",
        params,
        SCREENSHOT_TIMEOUT,
    )
    .await
    else {
        return data;
    };
    match smaller.get("data").and_then(Value::as_str) {
        Some(shrunk) if !shrunk.is_empty() && shrunk.len() < data.len() => {
            log::info!(
                "browser: 截图按 CSS px 收缩（{label}，{} → {} 字符）",
                data.len(),
                shrunk.len()
            );
            shrunk.to_string()
        }
        _ => data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_clicks_try_touch_first() {
        // 模拟态：touch → 关合成 + 鼠标 → 页面内合成
        assert_eq!(
            click_fallback_order(true),
            &["touch", "pointer", "synthetic"]
        );
        // 桌面态没有 touch 这条路，别做无谓的 2.5s 等待
        assert_eq!(click_fallback_order(false), &["pointer", "synthetic"]);
    }

    #[test]
    fn tap_event_carries_a_single_point_only_on_start() {
        let start = tap_event("touchStart", Some((12.5, 40.0)));
        assert_eq!(start["type"], "touchStart");
        assert_eq!(start["touchPoints"][0]["x"], 12.5);
        assert_eq!(start["touchPoints"][0]["y"], 40.0);

        // touchEnd 必须不带点位：带点位等于「手指还按着」，页面不会触发点击
        let end = tap_event("touchEnd", None);
        assert_eq!(end["type"], "touchEnd");
        assert_eq!(end["touchPoints"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    fn key_combo_marks_modifiers() {
        let combo = parse_key_combo("Ctrl+Enter");
        assert_eq!(combo.key, "Enter");
        assert_eq!(combo.vk, 13);
        assert_eq!(combo.modifiers, 2);
        // 带修饰键时不能带 text，否则页面会当成普通字符输入
        assert!(combo.text.is_empty());

        let plain = parse_key_combo("Enter");
        assert_eq!(plain.text, "\r");
    }

    #[test]
    fn screenshots_try_the_composited_surface_then_the_view() {
        // 窗口不可见时合成器可能不出帧，`fromSurface: true` 会一直等不到回调 ——
        // 所以顺序里必须留一条视图面的退路，而不是只有一条通道。
        assert_eq!(screenshot_channels(), [true, false]);

        let jpeg = screenshot_params("jpeg", true);
        assert_eq!(jpeg["format"], "jpeg");
        assert_eq!(jpeg["fromSurface"], true);
        assert_eq!(jpeg["quality"], json!(SCREENSHOT_JPEG_QUALITY));

        // png 不带 quality：那是 jpeg 专属字段
        let png = screenshot_params("png", false);
        assert_eq!(png["format"], "png");
        assert_eq!(png["fromSurface"], false);
        assert!(png.get("quality").is_none());
    }
}
