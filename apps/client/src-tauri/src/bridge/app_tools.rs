//! 浏览器工具（`app_browser_*`）在 app 侧的执行。
//!
//! 目录在 `cogito_core::tools::browser`（core 不依赖 tauri，只能放描述），
//! 这里负责拿到 `AppHandle` 后真正干活：全部走 `browser::agent` 的 CDP 通道 +
//! `browser::lifecycle` 的 webview 生命周期。
//!
//! `tab` 省略时落到**当前活动标签页** —— agent 和用户看到的是同一个页面。

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::browser::state::BrowserState;
use crate::browser::{agent, intercept, lifecycle, network};
use cogito_core::tools::browser as catalog;

/// 读页面默认返回多少项
const DEFAULT_LIMIT: u64 = 60;
/// 上限：太多会把模型上下文塞满，且帮助不大
const MAX_LIMIT: u64 = 200;
/// 网络列表默认 / 上限：比 read 宽，因为单条很短
const DEFAULT_NETWORK_LIMIT: usize = 200;
const MAX_NETWORK_LIMIT: usize = 500;
/// scroll 不传像素时的步长
const DEFAULT_SCROLL_PX: &str = "600";

/// 名字是否归这里管（桥靠它决定「先试 app 工具，再落到数据库工具」）
pub fn owns(name: &str) -> bool {
    catalog::owns(name)
}

/// 执行；`None` 表示不认识这个名字
pub async fn call(app: &AppHandle, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    let outcome = match name {
        catalog::OPEN => open(app, arguments).await,
        catalog::READ => read(app, arguments).await,
        catalog::ACT => act(app, arguments).await,
        catalog::SCREENSHOT => screenshot(app, arguments).await,
        catalog::NETWORK => network_list(app, arguments),
        catalog::INTERCEPT => intercept_rules(app, arguments).await,
        _ => return None,
    };
    Some(outcome)
}

/// 文本参数；空串按"没传"处理，避免把 `""` 当成合法地址
fn text_arg<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

/// `tab` 省略（或写 `active`）时取当前活动标签页
fn resolve_label(app: &AppHandle, arguments: &Value) -> Result<String, String> {
    if let Some(label) = text_arg(arguments, "tab") {
        if label != "active" {
            return Ok(label.to_string());
        }
    }
    let state = app.state::<BrowserState>();
    state
        .snapshot()
        .active
        .ok_or_else(|| "当前没有打开的浏览器标签页，先用 app_browser_open 打开一个".to_string())
}

async fn open(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let url = text_arg(arguments, "url")
        .ok_or_else(|| "缺少 url".to_string())?
        .to_string();
    let handle = app.clone();
    // `add_child` 内部阻塞等主线程，必须离开当前 async worker
    let tab = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<BrowserState>();
        lifecycle::open(&handle, state.inner(), &url)
    })
    .await
    .map_err(|error| format!("打开浏览器视图失败：{error}"))??;

    Ok(json!({ "label": tab.label, "url": tab.url }))
}

async fn read(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let mode = text_arg(arguments, "mode").unwrap_or("outline");
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT) as usize;
    agent::read(app, &label, mode, limit).await
}

async fn act(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let action = text_arg(arguments, "action").ok_or_else(|| "缺少 action".to_string())?;
    let selector = text_arg(arguments, "selector").unwrap_or("");
    let value = text_arg(arguments, "value").or_else(|| {
        if action == "scroll" {
            Some(DEFAULT_SCROLL_PX)
        } else {
            None
        }
    });

    // scroll 与 reload 不看选择器：它们作用于整页
    if action != "scroll" && action != "reload" && selector.is_empty() {
        return Err(format!("{action} 需要 selector（先 app_browser_read 拿一份）"));
    }
    agent::act(app, &label, action, selector, value).await
}

async fn screenshot(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    // 给模型看：JPEG 体积只有 PNG 的几分之一，判断样式/布局够用
    agent::screenshot(app, &label, Some("jpeg")).await
}

fn network_list(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let filter = text_arg(arguments, "filter");
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_NETWORK_LIMIT)
        .clamp(1, MAX_NETWORK_LIMIT);
    let requests = network::list(&label, filter, limit);
    Ok(json!({ "tab": label, "count": requests.len(), "requests": requests }))
}

async fn intercept_rules(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let rules: Vec<intercept::Rule> = arguments
        .get("rules")
        .cloned()
        .ok_or_else(|| "缺少 rules（传空数组表示关闭拦截）".to_string())
        .and_then(|value| {
            serde_json::from_value(value).map_err(|error| format!("rules 格式不对：{error}"))
        })?;
    let count = intercept::set_rules(app, &label, rules).await?;
    Ok(json!({ "tab": label, "active": count > 0, "count": count }))
}
