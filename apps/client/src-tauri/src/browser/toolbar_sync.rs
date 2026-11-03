//! 工具栏与浏览器 chrome 对齐：前进/后退可点态 + 实时 title。
//!
//! - `HistoryChanged` → 读 `CanGoBack` / `CanGoForward`，`emit browser://history`
//! - `DocumentTitleChanged` → 读 `DocumentTitle`，写 `BrowserState` 并广播 tabs-changed
//!
//! 这两条是 WebView2 原生事件（Edge 地址栏 / 前进后退同款），比轮询 CDP 更贴浏览器。

use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::state::BrowserState;

const MAIN_WINDOW: &str = "main";
const EVENT_HISTORY: &str = "browser://history";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryState {
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEvent {
    label: String,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Default)]
struct Hub {
    subscribed: HashSet<String>,
}

fn hub() -> &'static Mutex<Hub> {
    static HUB: OnceLock<Mutex<Hub>> = OnceLock::new();
    HUB.get_or_init(|| Mutex::new(Hub::default()))
}

fn with_hub<T>(action: impl FnOnce(&mut Hub) -> T) -> T {
    let mut guard = hub()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// 装 HistoryChanged + DocumentTitleChanged（幂等）。
pub fn install(app: &AppHandle, label: &str) {
    let already = with_hub(|hub| hub.subscribed.contains(label));
    if already {
        return;
    }

    let handle = app.clone();
    let owner = label.to_string();
    tauri::async_runtime::spawn(async move {
        match install_blocking(&handle, &owner) {
            Ok(()) => {
                with_hub(|hub| {
                    hub.subscribed.insert(owner.clone());
                });
                // 装上立刻推一次，避免按钮一直灰到第一次 HistoryChanged
                if let Ok(state) = fetch_history_state(&handle, &owner) {
                    emit_history(&handle, &owner, state);
                }
            }
            Err(error) => {
                log::warn!("browser: 工具栏同步安装失败（{owner}）: {error}");
            }
        }
    });
}

pub fn forget(label: &str) {
    with_hub(|hub| {
        hub.subscribed.remove(label);
    });
}

/// 主动读一次前进/后退能力（切 tab / 装完后兜底）。
pub fn fetch_history_state(app: &AppHandle, label: &str) -> Result<HistoryState, String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let (sender, receiver) = std::sync::mpsc::channel::<Result<HistoryState, String>>();

    webview
        .with_webview(move |platform| {
            #[cfg(windows)]
            let result = read_history_state(&platform);

            #[cfg(not(windows))]
            let result = {
                let _ = platform;
                Err("浏览器工具栏能力目前只实现 Windows（WebView2）".into())
            };

            let _ = sender.send(result);
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;

    receiver
        .recv_timeout(INSTALL_TIMEOUT)
        .map_err(|_| "读取历史状态超时（主线程未响应）".to_string())?
}

fn install_blocking(app: &AppHandle, label: &str) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let handle = app.clone();
    let owner = label.to_string();
    let (sender, receiver) = std::sync::mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |platform| {
            #[cfg(windows)]
            let result = install_windows(&platform, &handle, &owner);

            #[cfg(not(windows))]
            let result = {
                let _ = (&platform, &handle, &owner);
                Err("浏览器工具栏能力目前只实现 Windows（WebView2）".into())
            };

            let _ = sender.send(result);
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;

    receiver
        .recv_timeout(INSTALL_TIMEOUT)
        .map_err(|_| "订阅工具栏事件超时（主线程未响应）".to_string())?
}

fn emit_history(app: &AppHandle, label: &str, state: HistoryState) {
    if let Err(error) = app.emit_to(
        MAIN_WINDOW,
        EVENT_HISTORY,
        HistoryEvent {
            label: label.to_string(),
            can_go_back: state.can_go_back,
            can_go_forward: state.can_go_forward,
        },
    ) {
        log::warn!("browser: 广播 history 失败（{label}）: {error}");
    }
}

#[cfg(windows)]
fn publish_title(app: &AppHandle, label: &str, title: String) {
    let Some(browser) = app.try_state::<BrowserState>() else {
        return;
    };
    let current = browser.tab(label).map(|tab| tab.title);
    if current.as_deref() == Some(title.as_str()) {
        return;
    }
    browser.set_title(label, title);
    let snapshot = browser.snapshot();
    if let Err(error) = app.emit_to(MAIN_WINDOW, "browser://tabs-changed", &snapshot) {
        log::warn!("browser: title 变更广播失败（{label}）: {error}");
    }
}

#[cfg(windows)]
fn read_history_state(platform: &tauri::webview::PlatformWebview) -> Result<HistoryState, String> {
    use windows::core::BOOL;

    let controller = platform.controller();
    let core = unsafe { controller.CoreWebView2() }.map_err(|error| format!("读不到 CoreWebView2：{error}"))?;
    let mut can_back = BOOL(0);
    let mut can_forward = BOOL(0);
    unsafe { core.CanGoBack(&mut can_back) }.map_err(|error| format!("CanGoBack 失败：{error}"))?;
    unsafe { core.CanGoForward(&mut can_forward) }
        .map_err(|error| format!("CanGoForward 失败：{error}"))?;
    Ok(HistoryState {
        can_go_back: can_back.as_bool(),
        can_go_forward: can_forward.as_bool(),
    })
}

#[cfg(windows)]
fn install_windows(
    platform: &tauri::webview::PlatformWebview,
    app: &AppHandle,
    label: &str,
) -> Result<(), String> {
    use webview2_com::{DocumentTitleChangedEventHandler, HistoryChangedEventHandler};
    use windows::core::{BOOL, PWSTR};

    let controller = platform.controller();
    let core =
        unsafe { controller.CoreWebView2() }.map_err(|error| format!("读不到 CoreWebView2：{error}"))?;

    let history_app = app.clone();
    let history_label = label.to_string();
    let history_handler = HistoryChangedEventHandler::create(Box::new(move |sender, _args| {
        let Some(core) = sender else {
            return Ok(());
        };
        let mut can_back = BOOL(0);
        let mut can_forward = BOOL(0);
        if unsafe { core.CanGoBack(&mut can_back) }.is_err() {
            return Ok(());
        }
        if unsafe { core.CanGoForward(&mut can_forward) }.is_err() {
            return Ok(());
        }
        emit_history(
            &history_app,
            &history_label,
            HistoryState {
                can_go_back: can_back.as_bool(),
                can_go_forward: can_forward.as_bool(),
            },
        );
        Ok(())
    }));

    let mut history_token = Default::default();
    unsafe { core.add_HistoryChanged(&history_handler, &mut history_token) }
        .map_err(|error| format!("订阅 HistoryChanged 失败：{error}"))?;

    let title_app = app.clone();
    let title_label = label.to_string();
    let title_handler = DocumentTitleChangedEventHandler::create(Box::new(move |sender, _args| {
        let Some(core) = sender else {
            return Ok(());
        };
        let mut raw = PWSTR::null();
        if unsafe { core.DocumentTitle(&mut raw) }.is_err() {
            return Ok(());
        }
        let Ok(title) = (unsafe { raw.to_string() }) else {
            return Ok(());
        };
        publish_title(&title_app, &title_label, title);
        Ok(())
    }));

    let mut title_token = Default::default();
    unsafe { core.add_DocumentTitleChanged(&title_handler, &mut title_token) }
        .map_err(|error| format!("订阅 DocumentTitleChanged 失败：{error}"))?;

    log::info!("browser: 已订阅 HistoryChanged + DocumentTitleChanged（{label}）");
    Ok(())
}
