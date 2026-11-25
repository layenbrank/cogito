//! 宿主侧工具在 app 里的执行：浏览器（`cogito_browser_*`）与终端（`cogito_terminal_*`）。
//!
//! 目录在 `cogito_core::tools::{browser,terminal}`（core 不依赖 tauri，只能放描述），
//! 这里负责拿到 `AppHandle` 后真正干活：浏览器走 `browser::agent` 的 CDP 通道 +
//! `browser::lifecycle` 的 webview 生命周期；终端走 `utils::terminal` 的 PTY 会话。
//!
//! 两边都是「用户看得见的那个面板」：`tab` 省略时落到当前活动标签页，终端命令打进右栏
//! 那个 tab —— agent 和用户看到、能接管的是同一份东西。

use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

use crate::browser::state::BrowserState;
use crate::browser::{agent, emulate, intercept, lifecycle, network};
use crate::utils::terminal::{TerminalHub, resolve_agent_session_scoped};
use cogito_core::tools::agents as agents_catalog;
use cogito_core::tools::browser as browser_catalog;
use cogito_core::tools::terminal as terminal_catalog;

/// 子任务派发事件（渲染进程接活）：与 `shared/ipc/channels.ts` 的
/// `EVENTS.AGENT_SUBAGENT_SPAWN` 同名字符串。
const SUBAGENT_EVENT: &str = "agent://subagent-spawn";

/// 读页面默认返回多少项
const DEFAULT_LIMIT: u64 = 60;
/// 上限：太多会把模型上下文塞满，且帮助不大
const MAX_LIMIT: u64 = 200;
/// `mode=text` 默认返回多少字符（与条目数分开：正文以前被 60 个字符卡住）
const DEFAULT_MAX_CHARS: u64 = 8000;
/// 正文字符上限：再长就该分页读，塞进上下文也读不完
const MAX_MAX_CHARS: u64 = 200_000;
/// 网络列表默认 / 上限：比 read 宽，因为单条很短
const DEFAULT_NETWORK_LIMIT: usize = 200;
const MAX_NETWORK_LIMIT: usize = 500;
/// scroll 不传像素时的步长
const DEFAULT_SCROLL_PX: &str = "600";

/// 名字是否归这里管（桥靠它决定「先试 app 工具，再落到数据库工具」）
pub fn owns(name: &str) -> bool {
    browser_catalog::owns(name) || terminal_catalog::owns(name) || agents_catalog::owns(name)
}

/// 执行；`None` 表示不认识这个名字。
///
/// `session` 是发起方会话 id（桥从 `x-cogito-session` 解出来的）：子 agent 的深度
/// 只能由它推，模型在参数里写什么 `depth` 都不作数。
pub async fn call(
    app: &AppHandle,
    name: &str,
    arguments: &Value,
    session: Option<&str>,
) -> Option<Result<Value, String>> {
    let outcome = match name {
        browser_catalog::OPEN => open(app, arguments).await,
        browser_catalog::READ => read(app, arguments).await,
        browser_catalog::ACT => act(app, arguments).await,
        browser_catalog::WAIT => wait(app, arguments).await,
        browser_catalog::SCREENSHOT => screenshot(app, arguments).await,
        browser_catalog::NETWORK => network_list(app, arguments),
        browser_catalog::INTERCEPT => intercept_rules(app, arguments).await,
        browser_catalog::DEVICE => device(app, arguments).await,
        terminal_catalog::RUN => terminal_run(app, arguments, session).await,
        terminal_catalog::READ => terminal_read(app, arguments, session),
        terminal_catalog::WRITE => terminal_write(app, arguments, session),
        terminal_catalog::LIST => terminal_list(app),
        agents_catalog::SPAWN => agent_spawn(app, arguments, session).await,
        agents_catalog::WAIT => agent_wait(arguments).await,
        agents_catalog::RESULT => agent_result(arguments),
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

/// 多个别名里取第一个非空文本。
///
/// 模型会按它熟悉的概念写 key：ACP 叫 `sessionId`、`tail -n` 叫 `lines`。
/// 只报「缺少 id」会让它换个猜法重试 —— 别名归一比让它猜便宜得多。
fn pick_arg<'a>(arguments: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|key| text_arg(arguments, key))
}

/// 发起方会话 → 「它最近一次 `cogito_terminal_run` 的终端 id」。
///
/// 为什么要记：模型调 `cogito_terminal_read` 时手里往往只有一个会话（`x-cogito-session`），
/// 没有 tab id。要求它先去 `cogito_terminal_list` 再读，就多一步、多一次失败机会。
fn last_terminals() -> &'static Mutex<HashMap<String, String>> {
    static MAP: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remember_session_terminal(session: Option<&str>, id: &str) {
    let Some(session) = session.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if let Ok(mut map) = last_terminals().lock() {
        map.insert(session.to_string(), id.to_string());
    }
}

fn find_session_terminal(session: Option<&str>) -> Option<String> {
    let session = session?.trim();
    if session.is_empty() {
        return None;
    }
    last_terminals().lock().ok()?.get(session).cloned()
}

/// 输出首行带定位：调用方 `slice(-N)` 或只读 `output` 时，id 也不会被截掉
fn decorate_terminal_output(mut value: Value, with_cwd: bool) -> Value {
    let Some(record) = value.as_object_mut() else {
        return value;
    };
    let id = record
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let output = record
        .get("output")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let header = if with_cwd {
        let cwd = record
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let is_running = record
            .get("isRunning")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        format!("[terminal id={id} cwd={cwd} isRunning={is_running}]")
    } else {
        format!("[terminal id={id}]")
    };
    record.insert(
        "output".to_string(),
        Value::String(format!("{header}\n{output}")),
    );
    value
}

/// 终端定位缺失时的提示：带正确参数名与已知候选，让模型下一轮能自纠
fn missing_terminal_hint(app: &AppHandle) -> String {
    let mut ids: Vec<String> = Vec::new();
    if let Ok(Value::Array(rows)) = terminal_list(app) {
        for row in rows {
            if let Some(id) = row.get("id").and_then(Value::as_str) {
                ids.push(id.to_string());
            }
        }
    }
    let base = "缺少终端定位：`id` 是终端会话 id（**不是** `sessionId`），也可传 `cwd`（绝对路径，同目录复用同一个 tab）";
    if ids.is_empty() {
        format!("{base}；当前没有打开的终端，先用 cogito_terminal_run 跑一条命令")
    } else {
        format!("{base}；当前打开的终端：{}", ids.join(" / "))
    }
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
        .ok_or_else(|| "当前没有打开的浏览器标签页，先用 cogito_browser_open 打开一个".to_string())
}

async fn open(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let url = text_arg(arguments, "url")
        .ok_or_else(|| "缺少 url".to_string())?
        .to_string();
    let force_new = arguments
        .get("forceNew")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let before = app
        .state::<BrowserState>()
        .snapshot()
        .tabs
        .iter()
        .map(|tab| tab.label.clone())
        .collect::<std::collections::HashSet<_>>();

    let handle = app.clone();
    // `add_child` 内部阻塞等主线程，必须离开当前 async worker；
    // 同 host+port 复用由 lifecycle::open(force_new=false) 统一处理
    let tab = tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<BrowserState>();
        lifecycle::open(&handle, state.inner(), &url, force_new)
    })
    .await
    .map_err(|error| format!("打开浏览器视图失败：{error}"))??;

    let reused = before.contains(&tab.label);
    Ok(json!({
        "label": tab.label,
        "url": tab.url,
        "title": tab.title,
        "reused": reused
    }))
}

async fn read(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let mode = text_arg(arguments, "mode").unwrap_or("outline");
    let limit = arguments
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT) as usize;
    let selector = text_arg(arguments, "selector");
    let value = text_arg(arguments, "value");
    // 两个上限各管一件事：`limit` 是 outline 的条目数，`maxChars` 是 text 的字符数。
    // 以前 `limit` 被透传给正文切分，`mode=text` 只回来 60 个字符。
    let max_chars = arguments
        .get("maxChars")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_MAX_CHARS)
        .clamp(200, MAX_MAX_CHARS) as usize;
    agent::read(app, &label, mode, limit, max_chars, selector, value).await
}

async fn wait(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    let condition = text_arg(arguments, "condition").unwrap_or("selector");
    let selector = text_arg(arguments, "selector");
    let timeout_ms = arguments
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .unwrap_or(8_000);
    agent::wait(app, &label, condition, selector, timeout_ms).await
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
        return Err(format!(
            "{action} 需要 selector（先 cogito_browser_read 拿一份）"
        ));
    }
    agent::act(app, &label, action, selector, value).await
}

async fn screenshot(app: &AppHandle, arguments: &Value) -> Result<Value, String> {
    let label = resolve_label(app, arguments)?;
    // 给模型看：JPEG 体积只有 PNG 的几分之一，判断样式/布局够用。
    // fullPage 默认关：整页长图既贵，又有 Chromium 在底部重复顶部的问题。
    let full_page = arguments
        .get("fullPage")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    agent::screenshot(app, &label, Some("jpeg"), full_page).await
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

async fn terminal_run(
    app: &AppHandle,
    arguments: &Value,
    session: Option<&str>,
) -> Result<Value, String> {
    let command = text_arg(arguments, "command")
        .ok_or_else(|| "缺少 command".to_string())?
        .to_string();
    let cwd = text_arg(arguments, "cwd").map(str::to_string);
    let quiet_ms = arguments.get("quietMs").and_then(Value::as_u64);
    let timeout_ms = arguments.get("timeoutMs").and_then(Value::as_u64);
    // 作用域（线程 id）：给了就落到 `agent:<cwd>#<scope>`，两个线程在同目录跑命令
    // 时不再共用同一个 PTY；不给退化为旧的 `agent:<cwd>`（兼容旧调用方）。
    let scope = text_arg(arguments, "scope").map(str::to_string);

    let state = app.state::<TerminalHub>();
    let run = crate::utils::terminal::terminal_run(
        app.clone(),
        state,
        command,
        cwd,
        None,
        scope,
        quiet_ms,
        timeout_ms,
    )
    .await?;
    remember_session_terminal(session, &run.id);
    let value =
        serde_json::to_value(run).map_err(|error| format!("终端结果不可序列化：{error}"))?;
    Ok(decorate_terminal_output(value, true))
}

fn terminal_read(
    app: &AppHandle,
    arguments: &Value,
    session: Option<&str>,
) -> Result<Value, String> {
    let id = match pick_arg(arguments, &["id", "sessionId", "session_id", "session"]) {
        Some(id) => id.to_string(),
        None => match pick_arg(arguments, &["cwd", "workdir", "dir"]) {
            Some(cwd) => resolve_agent_session_scoped(cwd, text_arg(arguments, "scope"))?,
            // 什么都没传：读「本会话最近一次跑命令的那个终端」，这是模型最常见的意图
            None => find_session_terminal(session).ok_or_else(|| missing_terminal_hint(app))?,
        },
    };
    let max_chars = arguments
        .get("maxChars")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        // 模型常按 `tail -n` 传 `lines`：粗折算成字符（每行约 200）
        .or_else(|| {
            arguments
                .get("lines")
                .and_then(Value::as_u64)
                .map(|value| (value as usize).saturating_mul(200))
        });

    let state = app.state::<TerminalHub>();
    let read = crate::utils::terminal::terminal_read(state, id, max_chars)?;
    let value =
        serde_json::to_value(read).map_err(|error| format!("终端输出不可序列化：{error}"))?;
    Ok(decorate_terminal_output(value, false))
}

fn terminal_write(
    app: &AppHandle,
    arguments: &Value,
    session: Option<&str>,
) -> Result<Value, String> {
    // 允许纯空白（例如只发换行）；缺字段才报错
    let data = arguments
        .get("data")
        .and_then(Value::as_str)
        .ok_or_else(|| "缺少 data".to_string())?;
    let id = match pick_arg(arguments, &["id", "sessionId", "session_id", "session"]) {
        Some(id) => id.to_string(),
        None => match pick_arg(arguments, &["cwd", "workdir", "dir"]) {
            Some(cwd) => resolve_agent_session_scoped(cwd, text_arg(arguments, "scope"))?,
            None => find_session_terminal(session).ok_or_else(|| missing_terminal_hint(app))?,
        },
    };
    let state = app.state::<TerminalHub>();
    crate::utils::terminal::write_session(state.inner(), &id, data.as_bytes())?;
    Ok(json!({ "id": id, "bytes": data.len() }))
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
/// 优先用上次 `apply` 记下的可用盒子（真面板区）；没有时再从 layout
/// 按上一次 fit 折回（模拟态 layout 是设备盒子，直接除会二次缩小）。
fn estimate_fit(
    label: &str,
    layout: &crate::browser::state::Layout,
    device: &emulate::DeviceProfile,
) -> f64 {
    let (width, height) = if let Some(panel) = emulate::panel_of(label) {
        panel
    } else {
        let mut width = layout.width.max(1.0);
        let mut height = layout.height.max(1.0);
        if let Some(previous) = emulate::fit_of(label) {
            width /= previous;
            height /= previous;
        }
        (width, height)
    };
    emulate::clamp_fit(
        (width.max(1.0) / f64::from(device.width))
            .min(height.max(1.0) / f64::from(device.height))
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
    let status = intercept::set_rules(app, &label, rules).await?;
    // paused / matched 是「真的拦到了没有」的证据：`patterns: []` 那个 bug 时代它们恒为 0
    Ok(json!({
        "tab": label,
        "active": status.rules > 0,
        "count": status.rules,
        "paused": status.paused,
        "matched": status.matched
    }))
}

/// 子任务（S10）：登记 + 派给渲染进程，立刻返回 jobID。
///
/// 派不出去（没有窗口 / emit 失败）就把任务标成失败并直接报错 —— 让模型马上知道
/// 「这条路上没人接活」，而不是等一个永远不动的 `queued`。
async fn agent_spawn(
    app: &AppHandle,
    arguments: &Value,
    session: Option<&str>,
) -> Result<Value, String> {
    let request = agents_catalog::spawn_request(arguments, session)?;
    let job = agents_catalog::shared().spawn(request)?;
    let payload = json!({
        "jobID": job.id,
        "depth": job.depth,
        "title": job.title,
        "prompt": arguments.get("prompt").and_then(Value::as_str).unwrap_or_default(),
        "cwd": job.cwd,
        // 渲染进程按它解析父会话的 provider / model / workspace —— 子任务不提权
        "parentSession": job.parent_session
    });
    if let Err(error) = app.emit(SUBAGENT_EVENT, &payload) {
        let _ = agents_catalog::shared().settle(agents_catalog::Report {
            job_id: job.id.clone(),
            ok: false,
            summary: None,
            error: Some(format!("子任务派发失败：{error}")),
            session_id: None,
            cancelled: false,
        });
        return Err(format!("子任务派发失败：{error}"));
    }
    Ok(json!({
        "jobID": job.id,
        "status": job.status,
        "depth": job.depth,
        "title": job.title,
        "hint": "用 cogito_agent_wait 等它收尾；wait 超时只是「还没完」，不是失败"
    }))
}

/// 等子任务收尾。轮询足够：状态机在 core 里是同步的，这里只负责「等」与超时。
async fn agent_wait(arguments: &Value) -> Result<Value, String> {
    let job_id = text_arg(arguments, "jobID")
        .ok_or_else(|| "wait: 缺少 jobID".to_string())?
        .to_string();
    let timeout = agents_catalog::clamp_wait_ms(arguments.get("timeoutMs").and_then(Value::as_u64));
    let board = agents_catalog::shared();
    let started = std::time::Instant::now();
    let deadline = started + std::time::Duration::from_millis(timeout);
    loop {
        let job = board.view(&job_id)?;
        let active = matches!(
            job.status,
            agents_catalog::Status::Queued | agents_catalog::Status::Running
        );
        if !active {
            return Ok(json!({
                "jobID": job.id,
                "status": job.status,
                "depth": job.depth,
                "waitedMs": started.elapsed().as_millis() as u64,
                "sessionID": job.session_id,
                "summary": job.summary,
                "error": job.error
            }));
        }
        if std::time::Instant::now() >= deadline {
            return Ok(json!({
                "jobID": job.id,
                "status": job.status,
                "timedOut": true,
                "waitedMs": started.elapsed().as_millis() as u64,
                "hint": "还没收尾：再 wait 一次，或先做别的"
            }));
        }
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    }
}

/// 取结果（不阻塞）：没收尾就返回当前状态。
fn agent_result(arguments: &Value) -> Result<Value, String> {
    let job_id = text_arg(arguments, "jobID")
        .ok_or_else(|| "result: 缺少 jobID".to_string())?
        .to_string();
    let job = agents_catalog::shared().view(&job_id)?;
    Ok(json!({
        "jobID": job.id,
        "status": job.status,
        "depth": job.depth,
        "title": job.title,
        "sessionID": job.session_id,
        "summary": job.summary,
        "error": job.error
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_arg_accepts_model_aliases() {
        let arguments = json!({ "sessionId": "agent:D:\\\\work", "lines": 120 });
        assert_eq!(
            pick_arg(&arguments, &["id", "sessionId", "session_id", "session"]),
            Some("agent:D:\\\\work")
        );
        // 显式 id 优先于别名
        let both = json!({ "id": "agent:a", "sessionId": "agent:b" });
        assert_eq!(pick_arg(&both, &["id", "sessionId"]), Some("agent:a"));
        // 空串按「没传」处理
        let blank = json!({ "id": "  " });
        assert_eq!(pick_arg(&blank, &["id"]), None);
    }

    #[test]
    fn session_terminal_remembers_last_run() {
        let session = "goose-acp:test-session";
        remember_session_terminal(Some(session), "agent:D:\\\\work");
        assert_eq!(
            find_session_terminal(Some(session)),
            Some("agent:D:\\\\work".to_string())
        );
        // 别的会话互不串台；空会话不写也不读
        assert_eq!(find_session_terminal(Some("goose-acp:other")), None);
        remember_session_terminal(None, "agent:ignored");
        assert_eq!(find_session_terminal(None), None);
    }

    #[test]
    fn decorate_adds_locator_header() {
        let value = json!({
            "id": "agent:D:\\\\work",
            "cwd": "D:\\\\work",
            "output": "done",
            "isRunning": true
        });
        let decorated = decorate_terminal_output(value, true);
        let output = decorated
            .get("output")
            .and_then(Value::as_str)
            .unwrap_or("");
        assert!(output.starts_with("[terminal id=agent:D:\\\\work cwd=D:\\\\work isRunning=true]"));
        assert!(output.ends_with("done"));
    }
}
