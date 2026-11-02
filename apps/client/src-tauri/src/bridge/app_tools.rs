//! 宿主侧工具在 app 里的执行：浏览器（`app_browser_*`）与终端（`app_terminal_*`）。
//!
//! 目录在 `cogito_core::tools::{browser,terminal}`（core 不依赖 tauri，只能放描述），
//! 这里负责拿到 `AppHandle` 后真正干活：浏览器走 `browser::agent` 的 CDP 通道 +
//! `browser::lifecycle` 的 webview 生命周期；终端走 `utils::terminal` 的 PTY 会话。
//!
//! 两边都是「用户看得见的那个面板」：`tab` 省略时落到当前活动标签页，终端命令打进右栏
//! 那个 tab —— agent 和用户看到、能接管的是同一份东西。

use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::browser::state::BrowserState;
use crate::browser::{agent, emulate, intercept, lifecycle, network};
use crate::utils::terminal::{TerminalHub, resolve_agent_session};
use cogito_core::tools::browser as browser_catalog;
use cogito_core::tools::terminal as terminal_catalog;

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
    browser_catalog::owns(name) || terminal_catalog::owns(name)
}

/// 执行；`None` 表示不认识这个名字
pub async fn call(app: &AppHandle, name: &str, arguments: &Value) -> Option<Result<Value, String>> {
    let outcome = match name {
        browser_catalog::OPEN => open(app, arguments).await,
        browser_catalog::READ => read(app, arguments).await,
        browser_catalog::ACT => act(app, arguments).await,
        browser_catalog::SCREENSHOT => screenshot(app, arguments).await,
        browser_catalog::NETWORK => network_list(app, arguments),
        browser_catalog::INTERCEPT => intercept_rules(app, arguments).await,
        browser_catalog::DEVICE => device(app, arguments).await,
        terminal_catalog::RUN => terminal_run(app, arguments).await,
        terminal_catalog::READ => terminal_read(app, arguments),
        terminal_catalog::LIST => terminal_list(app),
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

async fn terminal_run(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let command = text_arg(arguments, "command")
        .ok_or_else(|| "缺少 command".to_string())?
        .to_string();
    let cwd = text_arg(arguments, "cwd").map(str::to_string);
    let quiet_ms = arguments.get("quietMs").and_then(Value::as_u64);
    let timeout_ms = arguments.get("timeoutMs").and_then(Value::as_u64);

    let state = app.state::<TerminalHub>();
    let run = crate::utils::terminal::terminal_run(
        app.clone(),
        state,
        command,
        cwd,
        None,
        quiet_ms,
        timeout_ms,
    )
    .await?;
    serde_json::to_value(run).map_err(|error| format!("终端结果不可序列化：{error}"))
}

fn terminal_read(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let id = match text_arg(arguments, "id") {
        Some(id) => id.to_string(),
        None => {
            let cwd = text_arg(arguments, "cwd").ok_or_else(|| "缺少 id 或 cwd".to_string())?;
            resolve_agent_session(cwd)?
        }
    };
    let max_chars = arguments
        .get("maxChars")
        .and_then(Value::as_u64)
        .map(|value| value as usize);

    let state = app.state::<TerminalHub>();
    let read = crate::utils::terminal::terminal_read(state, id, max_chars)?;
    serde_json::to_value(read).map_err(|error| format!("终端输出不可序列化：{error}"))
}

/// 设备模拟：`preset` 或 `width + height (+ dpr/mobile/userAgent)`，`off=true` 复原。
///
/// 返回页面自报的视口（innerWidth / dpr / pointerCoarse），agent 才能确认真的生效
/// 而不是「命令发了但被 WebView2 吞了」。
async fn device(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let state = app.state::<BrowserState>();
    if state.tab(&label).is_none() {
        return Err(format!("没有这个 tab：{label}"));
    }

    if arguments
        .get("off")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        emulate::apply(app, &label, None, 1.0).await?;
        state.set_device(&label, None);
        lifecycle::broadcast(app, state.inner());
        let readback = emulate::readback(app, &label).await.unwrap_or_default();
        return Ok(json!({ "tab": label, "device": Value::Null, "readback": readback }));
    }

    let device = match text_arg(arguments, "preset") {
        Some(preset) => emulate::preset(preset).ok_or_else(|| {
            format!(
                "没有这个预设：{preset}（可用：{}）",
                emulate::preset_ids().join(" / ")
            )
        })?,
        None => {
            let width = arguments
                .get("width")
                .and_then(Value::as_u64)
                .ok_or_else(|| "需要 preset，或者同时给 width + height".to_string())?
                as u32;
            let height = arguments
                .get("height")
                .and_then(Value::as_u64)
                .ok_or_else(|| "自定义设备需要 height".to_string())?
                as u32;
            emulate::DeviceProfile {
                width,
                height,
                dpr: arguments.get("dpr").and_then(Value::as_f64),
                mobile: arguments
                    .get("mobile")
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
                user_agent: text_arg(arguments, "userAgent").map(str::to_string),
            }
        }
    };
    device.validate()?;

    let fit = estimate_fit(&label, &state.snapshot().layout, &device);
    emulate::apply(app, &label, Some(&device), fit).await?;
    state.set_device(&label, Some(device.clone()));
    // 前端要按自己的面板尺寸重算 fit，先让它知道设备变了
    lifecycle::broadcast(app, state.inner());

    let readback = emulate::readback(app, &label).await.unwrap_or_default();
    Ok(json!({
        "tab": label,
        "device": device,
        "fit": fit,
        "scaleChannel": emulate::channel().as_str(),
        "readback": readback
    }))
}

/// 估算 fit：面板宽高 / 设备宽高，取小者，上限 1。
///
/// 模拟态下 `layout` 上报的是**设备盒子**（设备尺寸 × 上一次的 fit），
/// 直接拿它算会让每次切设备都再缩一圈 —— 先按上一次 fit 折回面板尺寸。
fn estimate_fit(
    label: &str,
    layout: &crate::browser::state::Layout,
    device: &emulate::DeviceProfile,
) -> f64 {
    let mut width = layout.width.max(1.0);
    let mut height = layout.height.max(1.0);
    if let Some(previous) = emulate::fit_of(label) {
        width /= previous;
        height /= previous;
    }
    emulate::clamp_fit(
        (width / f64::from(device.width))
            .min(height / f64::from(device.height))
            .min(1.0),
    )
}

fn terminal_list(app: &AppHandle) -> Result<Value, String> {
    let state = app.state::<TerminalHub>();
    let sessions = crate::utils::terminal::terminal_list(state)?;
    serde_json::to_value(sessions).map_err(|error| format!("终端会话不可序列化：{error}"))
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
