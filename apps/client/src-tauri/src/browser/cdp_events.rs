//! CDP 事件订阅（网络记录 / 请求拦截的底座）。
//!
//! `cdp::call` 是「问一句答一句」，而 `Network.*` / `Fetch.requestPaused` 是**推送**：
//! 必须走 WebView2 的事件接收器（`GetDevToolsProtocolEventReceiver`）。
//!
//! 线程模型：`with_webview` 只是把闭包投递到主线程（非阻塞），回调本身也在主线程跑。
//! 所以 `sink` **必须立刻返回** —— 任何要 await 的后续动作（例如
//! `Fetch.continueRequest`）都得自己 `spawn` 出去，否则会把主线程堵死。

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// 事件回调：拿到一段 CDP 事件参数的 JSON
pub type EventSink = Arc<dyn Fn(&str) + Send + Sync + 'static>;

/// 安装等待上限：`with_webview` 是投递到主线程，主线程繁忙时不能无限期等
const INSTALL_TIMEOUT: Duration = Duration::from_secs(5);

/// 给某个 webview 订阅一个 CDP 事件，**等到真装上才返回**。
///
/// 为什么必须同步：调用方的下一步通常是 `*.enable`，而 enable 一执行事件就开始推送。
/// 订阅晚一步就意味着没人处理（`Fetch` 域更是直接把所有请求挂起）。
///
/// 因此本函数会阻塞等主线程，**不能在主线程上调用**（事件回调里也不能调）。
///
/// 前置条件：`Network.*` 要先 `Network.enable`，`Fetch.*` 要先 `Fetch.enable` ——
/// 但这只决定事件会不会产生，不影响订阅本身的安全性。
pub fn subscribe(
    app: &AppHandle,
    label: &str,
    event: &str,
    sink: EventSink,
) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let owner = label.to_string();
    let event_name = event.to_string();
    let event = event_name.clone();
    let (sender, receiver) = std::sync::mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |platform| {
            #[cfg(windows)]
            let result = install(&platform, &owner, &event, sink);

            #[cfg(not(windows))]
            let result = {
                let _ = (&platform, &owner, &event, sink);
                Err("CDP 事件目前只在 Windows 实现".to_string())
            };

            // 主线程一旦把它丢了，这里会拿到 RecvTimeoutError
            let _ = sender.send(result);
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;

    receiver
        .recv_timeout(INSTALL_TIMEOUT)
        .map_err(|_| format!("订阅 {event_name} 超时（主线程未响应）"))?
}

#[cfg(windows)]
fn install(
    platform: &tauri::webview::PlatformWebview,
    owner: &str,
    event: &str,
    sink: EventSink,
) -> Result<(), String> {
    use webview2_com::DevToolsProtocolEventReceivedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2DevToolsProtocolEventReceivedEventArgs;
    use windows::core::{HSTRING, PWSTR};

    let controller = platform.controller();
    let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
        return Err(format!("读不到 CoreWebView2（{owner}）"));
    };

    let event_h = HSTRING::from(event);
    let Ok(receiver) = (unsafe { core.GetDevToolsProtocolEventReceiver(&event_h) }) else {
        return Err(format!("取不到事件接收器（{event} / {owner}）"));
    };

    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
        move |_sender,
              args: Option<ICoreWebView2DevToolsProtocolEventReceivedEventArgs>| {
            let Some(args) = args else {
                return Ok(());
            };
            // `ParameterObjectAsJson` 是出参式 API（COM 风格），失败就当这条事件丢了：
            // 网络记录不值得把 COM 回调搞崩
            let mut raw = PWSTR::null();
            if unsafe { args.ParameterObjectAsJson(&mut raw) }.is_err() {
                return Ok(());
            }
            let Ok(text) = (unsafe { raw.to_string() }) else {
                return Ok(());
            };
            sink(&text);
            Ok(())
        },
    ));

    let mut token = Default::default();
    if let Err(error) = unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &mut token) } {
        return Err(format!("订阅 {event} 失败（{owner}）: {error}"));
    }
    log::info!("browser: 已订阅 {event}（{owner}）");
    Ok(())
}
