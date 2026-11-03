//! 浏览器面板的 IPC 面。
//!
//! 全部参数用逻辑像素（前端拿到的是 CSS px），缩放换算交给 Tauri。
//! 这些命令只给**主 webview** 用 —— 浏览器 tab 加载的是远程 origin，没有配
//! capability 的 `remote.urls`，调不到任何命令。

use tauri::{AppHandle, Manager, State};

use super::agent;
use super::emulate::{self, DeviceProfile};
use super::intercept::{self, Rule};
use super::lifecycle;
use super::network::{self, NetEntry};
use super::picker;
use super::state::{BrowserState, BrowserTab};

/// 新建标签页。
///
/// **必须是 async + spawn_blocking**：`Window::add_child` 内部是
/// 「投递到主线程 → `rx.recv()` 阻塞等结果」，而同步 command 本身就占着主线程，
/// 于是自己等自己，命令永不返回（表现为：地址栏回车没反应、没有报错、没有 tab）。
/// `force_new` 默认 true（用户点 + 总是新建）；agent 工具面默认 false 走复用。
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    url: String,
    force_new: Option<bool>,
) -> Result<BrowserTab, String> {
    let force_new = force_new.unwrap_or(true);
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<BrowserState>();
        lifecycle::open(&app, &state, &url, force_new)
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

/// 前进 / 后退按钮灰态（WebView2 CanGoBack / CanGoForward）
#[tauri::command]
pub fn browser_history_state(
    app: AppHandle,
    label: String,
) -> Result<super::toolbar_sync::HistoryState, String> {
    super::toolbar_sync::fetch_history_state(&app, &label)
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
    format: Option<String>,
) -> Result<serde_json::Value, String> {
    // 默认 PNG（用户截图进输入框）；浮层暂停占位传 jpeg 控制体积
    agent::screenshot(&app, &label, format.as_deref()).await
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

/// 开始 CDP Overlay 元素拾取（VS Code 同款）
#[tauri::command]
pub async fn browser_picker_start(app: AppHandle, label: String) -> Result<(), String> {
    picker::start(&app, &label).await
}

/// 取消元素拾取
#[tauri::command]
pub async fn browser_picker_stop(app: AppHandle, label: String) -> Result<(), String> {
    picker::stop(&app, &label).await
}

/// 当前 tab 的设备档案（`null` = 桌面态）。UI 切 tab 时用来对齐。
#[tauri::command]
pub fn browser_device_get(state: State<'_, BrowserState>, label: String) -> Option<DeviceProfile> {
    state.tab(&label).and_then(|tab| tab.device)
}

/// 设置 / 退出设备模拟。
///
/// `device = null` 退出（清掉 metrics / touch / media / UA 覆盖并复位缩放）；
/// `fit` 是「设备盒子相对面板」的缩放比，由前端按面板尺寸算好传进来。
///
/// 覆盖先下发、成功了才落状态：CDP 失败时前端仍显示旧设备，重试语义干净。
/// 但 `apply` 内部可能已经改了一部分 —— 所以失败时按状态里的那份重放一次，
/// 让页面回到记录中的设备，而不是半新半旧。
#[tauri::command]
pub async fn browser_device_set(
    app: AppHandle,
    state: State<'_, BrowserState>,
    label: String,
    device: Option<DeviceProfile>,
    fit: Option<f64>,
) -> Result<serde_json::Value, String> {
    let Some(tab) = state.tab(&label) else {
        return Err(format!("没有这个 tab：{label}"));
    };
    let fit = fit.unwrap_or(1.0);
    let previous = tab.device;
    let previous_fit = emulate::fit_of(&label).unwrap_or(1.0);

    match emulate::apply(&app, &label, device.as_ref(), fit).await {
        Ok(()) => {
            state.set_device(&label, device.clone());
            // UI 路径也广播：让其它订阅方（及 tabs[].device）跟上，不只靠本地 setDevice
            lifecycle::broadcast(&app, state.inner());
            let readback = emulate::readback(&app, &label).await.unwrap_or_default();
            Ok(serde_json::json!({
                "tab": label,
                "device": device,
                "fit": emulate::clamp_fit(fit),
                "scaleChannel": emulate::channel().as_str(),
                "readback": readback
            }))
        }
        Err(error) => {
            if let Err(replay_error) =
                emulate::apply(&app, &label, previous.as_ref(), previous_fit).await
            {
                log::warn!("browser: 设备模拟失败后回滚也失败（{label}）: {replay_error}");
            }
            Err(error)
        }
    }
}
