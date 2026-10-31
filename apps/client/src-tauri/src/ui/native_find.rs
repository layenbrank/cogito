//! 关掉 WebView 原生「页内查找」（Ctrl/Cmd+F 的 Chromium / WebView2 find bar）。
//!
//! Windows：`AreBrowserAcceleratorKeysEnabled = false`（含 Ctrl+F / F3 等浏览器加速键）。
//! macOS / Linux：无对等设置，由前端键派发器对查找键做 `preventDefault`。

use tauri::{AppHandle, Manager, WebviewWindow};

/// 对当前已存在的全部 webview 窗口禁用原生查找。
pub fn disable_on_app(app: &AppHandle) {
    for window in app.webview_windows().into_values() {
        disable_on_window(&window);
    }
}

/// 对单个窗口禁用原生查找（新建 overlay 等路径也要再调一次）。
pub fn disable_on_window(window: &WebviewWindow) {
    #[cfg(windows)]
    disable_windows(window);

    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

#[cfg(windows)]
fn disable_windows(window: &WebviewWindow) {
    let label = window.label().to_string();
    let label_for_webview = label.clone();
    // `with_webview` 需要 wry feature（tauri 默认开启）；闭包要求 `'static`，先拷 label。
    if let Err(error) = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;

        let label = label_for_webview;
        let controller = webview.controller();
        let Ok(core) = (unsafe { controller.CoreWebView2() }) else {
            tracing::warn!("native_find: 读不到 CoreWebView2（label={label}）");
            return;
        };
        let Ok(settings) = (unsafe { core.Settings() }) else {
            tracing::warn!("native_find: 读不到 Settings（label={label}）");
            return;
        };
        let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() else {
            tracing::warn!("native_find: Settings3 不可用（label={label}）");
            return;
        };
        if let Err(error) = unsafe { settings3.SetAreBrowserAcceleratorKeysEnabled(false) } {
            tracing::warn!(
                "native_find: SetAreBrowserAcceleratorKeysEnabled 失败（label={label}）: {error}"
            );
        }
    }) {
        tracing::warn!("native_find: with_webview 失败（label={label}）: {error}");
    }
}
