//! 通过 WebView2 的 CDP 通道访问浏览器 tab（`ICoreWebView2::CallDevToolsProtocolMethod`）。
//!
//! 为什么走 CDP 而不是注入脚本 + `eval`：`Webview::eval` 是单向的，拿不到返回值；
//! 而 agent 需要「读回页面结构 / 网络记录 / 截图」。CDP 的响应是 JSON，正好是
//! 工具面要的形状，且不需要给浏览器 tab 开任何 IPC 权限。
//!
//! 线程模型（务必理解，否则改一行就死锁）：
//! `with_webview` 把闭包投递到主线程并**阻塞等待**执行完；而 CDP 的完成回调
//! 也要靠主线程的消息循环派发。所以闭包里只注册 handler 然后立刻返回，
//! 结果通过 oneshot 传出来，`await` 发生在命令自己的线程上。
//!
//! 另外，DevTools 协议是能力也是风险：这里**只暴露固定方法名**给上层，
//! 不接受前端传任意 `method` 字符串。

#[cfg(windows)]
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::Value;
use tauri::AppHandle;

/// 单次 CDP 调用上限：页面卡死时不能让工具调用一直挂着。
const CALL_TIMEOUT: Duration = Duration::from_secs(10);

/// 调一个 CDP 方法，返回**方法返回值本身**（默认超时）。
///
/// 注意这里没有 `{"result": ...}` 外层包装：`CallDevToolsProtocolMethod` 的 JSON
/// 回调给的就是该方法自己的返回对象。所以取字段要按方法约定来 ——
/// `Page.captureScreenshot` 是 `{data}`，而 `Runtime.evaluate` 是
/// `{result: RemoteObject, exceptionDetails?}`（它的 `result` 是字段，不是包装）。
#[cfg(windows)]
pub async fn call(
    app: &AppHandle,
    label: &str,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    call_with_timeout(app, label, method, params, CALL_TIMEOUT).await
}

/// 同 `call`，但可以指定超时。
///
/// 输入类调用（`Input.dispatchMouseEvent` / `Input.dispatchTouchEvent`）单独用短超时：
/// 设备模拟下鼠标事件会被合成成 touch，`mousePressed` 可能等不到 WebView2 的完成回调，
/// 默认 10s 会让每次点击都卡十秒。
#[cfg(windows)]
pub async fn call_with_timeout(
    app: &AppHandle,
    label: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    use tauri::Manager;
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::HSTRING;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;

    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let pending = Arc::new(StdMutex::new(Some(sender)));
    let method_owned = method.to_string();
    let method_h = HSTRING::from(method);
    let params_h = HSTRING::from(params.to_string());

    webview
        .with_webview(move |platform| {
            let fail = |message: String| {
                if let Some(sender) = pending.lock().ok().and_then(|mut guard| guard.take()) {
                    let _ = sender.send(Err(message));
                }
            };

            let controller = platform.controller();
            let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
                fail("读不到 CoreWebView2".into());
                return;
            };

            let callback = Arc::clone(&pending);
            let method_for_error = method_owned;
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |error_code, result_json| {
                    let outcome = if error_code.is_ok() {
                        Ok(result_json.to_string())
                    } else {
                        Err(format!(
                            "CDP {method_for_error} 失败：{error_code:?} {result_json}"
                        ))
                    };
                    if let Some(sender) = callback.lock().ok().and_then(|mut guard| guard.take()) {
                        let _ = sender.send(outcome);
                    }
                    Ok(())
                },
            ));

            if let Err(error) =
                unsafe { core.CallDevToolsProtocolMethod(&method_h, &params_h, &handler) }
            {
                fail(format!("发起 CDP 调用失败：{error}"));
            }
        })
        .map_err(|error| format!("投递到主线程失败：{error}"))?;

    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(Ok(raw))) => serde_json::from_str(&raw).map_err(|error| {
            log::warn!("browser: CDP 响应不是合法 JSON（{method}）: {error}");
            format!("CDP 响应解析失败：{error}")
        }),
        Ok(Ok(Err(message))) => Err(message),
        Ok(Err(_)) => Err("CDP 调用被丢弃".into()),
        Err(_) => Err(format!("CDP {method} 超时（{timeout:?}）")),
    }
}

#[cfg(not(windows))]
pub async fn call(
    _app: &AppHandle,
    _label: &str,
    _method: &str,
    _params: Value,
) -> Result<Value, String> {
    Err("浏览器内嵌能力目前只实现 Windows（WebView2）".into())
}

#[cfg(not(windows))]
pub async fn call_with_timeout(
    _app: &AppHandle,
    _label: &str,
    _method: &str,
    _params: Value,
    _timeout: Duration,
) -> Result<Value, String> {
    Err("浏览器内嵌能力目前只实现 Windows（WebView2）".into())
}
