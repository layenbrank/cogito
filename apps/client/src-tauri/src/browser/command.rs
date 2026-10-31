//! 浏览器面板的 IPC 面。
//!
//! 全部参数用逻辑像素（前端拿到的是 CSS px），缩放换算交给 Tauri。
//! 这些命令只给**主 webview** 用 —— 浏览器 tab 加载的是远程 origin，没有配
//! capability 的 `remote.urls`，调不到任何命令。

use tauri::{AppHandle, Manager, State};

use super::agent;
use super::intercept::{self, Rule};
use super::lifecycle;
use super::network::{self, NetEntry};
use super::state::{BrowserState, BrowserTab};

/// 新建标签页。
///
/// **必须是 async + spawn_blocking**：`Window::add_child` 内部是
/// 「投递到主线程 → `rx.recv()` 阻塞等结果」，而同步 command 本身就占着主线程，
/// 于是自己等自己，命令永不返回（表现为：地址栏回车没反应、没有报错、没有 tab）。
#[tauri::command]
pub async fn browser_open(app: AppHandle, url: String) -> Result<BrowserTab, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BrowserState>();
        lifecycle::open(&app, &state, &url)
    })
    .await
    .map_err(|error| format!("打开浏览器视图失败：{error}"))?
}

#[tauri::command]
pub fn browser_close(
    app: AppHandle,
    state: State<'_, BrowserState>,
    label: String,
) -> Result<(), String> {
    lifecycle::close(&app, state.inner(), &label)
}

#[tauri::command]
pub fn browser_activate(
    app: AppHandle,
    state: State<'_, BrowserState>,
    label: String,
) -> Result<(), String> {
    lifecycle::activate(&app, state.inner(), &label)
}

#[tauri::command]
pub fn browser_layout(
    app: AppHandle,
    state: State<'_, BrowserState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    lifecycle::layout(&app, state.inner(), x, y, width, height)
}

#[tauri::command]
pub fn browser_visible(
    app: AppHandle,
    state: State<'_, BrowserState>,
    visible: bool,
) -> Result<(), String> {
    lifecycle::set_visible(&app, state.inner(), visible)
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    state: State<'_, BrowserState>,
    label: String,
    url: String,
) -> Result<(), String> {
    lifecycle::navigate(&app, state.inner(), &label, &url)
}

#[tauri::command]
pub fn browser_current_url(app: AppHandle, label: String) -> Result<String, String> {
    lifecycle::current_url(&app, &label)
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    lifecycle::reload(&app, &label)
}

#[tauri::command]
pub fn browser_devtools(app: AppHandle, label: String) -> Result<(), String> {
    lifecycle::open_devtools(&app, &label)
}

#[tauri::command]
pub fn browser_history(app: AppHandle, label: String, backward: bool) -> Result<(), String> {
    lifecycle::step_history(&app, &label, backward)
}

/// 当前浏览器快照（tabs + 活动 label + 布局）。
///
/// 前端页面刷新后内存态丢失，靠它把仍然活着的 webview 重新挂回 UI。
#[tauri::command]
pub fn browser_snapshot(state: State<'_, BrowserState>) -> crate::browser::state::LayoutSnapshot {
    state.snapshot()
}

/// 网络请求列表（最新在前）
#[tauri::command]
pub fn browser_network_list(
    label: String,
    filter: Option<String>,
    limit: Option<usize>,
) -> Vec<NetEntry> {
    network::list(&label, filter.as_deref(), limit.unwrap_or(200).min(500))
}

/// 设置拦截规则；空数组 = 关闭。返回生效条数。
#[tauri::command]
pub async fn browser_intercept_set(
    app: AppHandle,
    label: String,
    rules: Vec<Rule>,
) -> Result<usize, String> {
    intercept::set_rules(&app, &label, rules).await
}

/// 当前生效的拦截规则（agent 也可能改过，UI 靠它对齐）
#[tauri::command]
pub fn browser_intercept_list(label: String) -> Vec<Rule> {
    intercept::rules(&label)
}

/// 诊断探针：验证 CDP 通道（`Runtime` / `Network` / `Fetch`）在本机可用
#[tauri::command]
pub async fn browser_probe(app: AppHandle, label: String) -> Result<serde_json::Value, String> {
    agent::probe(&app, &label).await
}

#[tauri::command]
pub async fn browser_agent_read(
    app: AppHandle,
    label: String,
    mode: Option<String>,
    limit: Option<usize>,
) -> Result<serde_json::Value, String> {
    agent::read(&app, &label, mode.as_deref().unwrap_or("outline"), limit.unwrap_or(60)).await
}

#[tauri::command]
pub async fn browser_agent_screenshot(
    app: AppHandle,
    label: String,
) -> Result<serde_json::Value, String> {
    // 面板这边是给用户看的，用无损 PNG
    agent::screenshot(&app, &label, None).await
}

#[tauri::command]
pub async fn browser_agent_act(
    app: AppHandle,
    label: String,
    action: String,
    selector: String,
    value: Option<String>,
) -> Result<serde_json::Value, String> {
    agent::act(&app, &label, &action, &selector, value.as_deref()).await
}
