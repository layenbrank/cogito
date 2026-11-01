//! agent 面向浏览器 tab 的读写工具面（P0 探针 + 后续 read/act/network 的底座）。
//!
//! 这里刻意**不给** `eval`：agent 只能调下面这些固定动作。开放任意脚本等于把
//! 整个页面（含 cookie / 登录态）交出去，而且无法做输入校验。

use serde_json::{Value, json};
use tauri::AppHandle;

use super::cdp;
use super::intercept;
use super::lifecycle;

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

/// 读页面：`text` 取正文，`outline` 取可交互元素的清单（agent 用来决定点哪里）。
///
/// 两种模式都带上 `url` / `title`：agent 必须能确认“我现在在哪一页”，
/// SPA 路由变化不会触发新导航，光靠地址栏是看不出来的。
pub async fn read(app: &AppHandle, label: &str, mode: &str, limit: usize) -> Result<Value, String> {
    let expression = match mode {
        "text" => format!(
            r#"(() => {{
                const body = document.body;
                if (!body) return {{ url: location.href, title: document.title, text: '' }};
                const text = (body.innerText || '').replace(/\n{{3,}}/g, '\n\n').trim();
                return {{
                    url: location.href,
                    title: document.title,
                    text: text.slice(0, {limit}),
                    truncated: text.length > {limit}
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
        "click" | "type" | "press" | "scroll" | "hover" | "reload"
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
    let selector_json = Value::String(selector.to_string()).to_string();
    let value_json = match value {
        Some(text) => Value::String(text.to_string()).to_string(),
        None => "null".to_string(),
    };

    let expression = format!(
        r#"(() => {{
            const value = {value_json};

            // scroll 不看元素：agent 的意思是“把页面往下翻”，指定 selector 反而不方便
            if ({action_json} === 'scroll') {{
                window.scrollBy(0, Number(value) || 600);
            }} else {{
                const el = document.querySelector({selector_json});
                if (!el) return {{ ok: false, reason: '没有匹配的元素' }};
                switch ({action_json}) {{
                    case 'click':
                        el.click();
                        break;
                    case 'hover':
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
                }}
            }}

            // 点完 / 输完页面往往异步刷新，给一帧多一点再回来；不让 agent 自己去竞速
            return new Promise((resolve) => {{
                setTimeout(() => resolve({{ ok: true, url: location.href, title: document.title }}), 250);
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

/// 截屏：`Page.captureScreenshot` 拿 base64，返回原始 base64 + mime。
///
/// 不返回 data URL：同一份 base64 再拼一遍会让 JSON 体积翻倍。需要 data URL 的
/// 调用方（前端/面板）自己拼一行就行。
///
/// `format`：`jpeg` 给模型看（体积小很多，样式判断够用），`png` 给用户看。
/// 注意 `fromSurface: true` 取的是**合成后**画面：webview 被 `hide()` 时（切走页签 /
/// 浮层让位）可能拿到空白或直接报错 —— 调用前确保它可见。
pub async fn screenshot(
    app: &AppHandle,
    label: &str,
    format: Option<&str>,
) -> Result<Value, String> {
    const JPEG_QUALITY: u8 = 75;

    let (cdp_format, mime_type) = match format {
        Some("jpeg") => ("jpeg", "image/jpeg"),
        _ => ("png", "image/png"),
    };
    let mut params = json!({ "format": cdp_format, "fromSurface": true });
    if cdp_format == "jpeg" {
        params["quality"] = json!(JPEG_QUALITY);
    }

    // 注意：`cdp::call` 返回的已经是**方法返回值本身**。
    // `Page.captureScreenshot` 的返回值就是 `{"data": "..."}`；
    // 只有 `Runtime.evaluate` 那种才会多一层 `result`（那是它的 RemoteObject 字段）。
    let mut response = cdp::call(app, label, "Page.captureScreenshot", params.clone()).await?;

    if response.get("data").is_none() {
        // 空图不是报错：webview 隐藏（切在聊天视图 / 浮层让位）时 WebView2 会返回空对象。
        // 临时显示一下再拍，拍完收回 —— 否则 agent 在聊天视图下永远截不到图。
        log::info!("browser: 截图拿到空数据，临时显示后重试（{label}）");
        if !lifecycle::reveal_for_capture(app, label) {
            return Err("截图响应里没有 data（页面可能还没显示出来）".to_string());
        }
        let retried = cdp::call(app, label, "Page.captureScreenshot", params).await;
        lifecycle::hide_after_capture(app, label);
        response = retried?;
    }

    let data = response
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            log::warn!("browser: 截图响应里没有 data（{label}）: {response}");
            "截图响应里没有 data".to_string()
        })?;

    Ok(json!({ "mimeType": mime_type, "base64": data }))
}
