use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Webview;

/// 子 Webview 的强引用。Tauri 的 `webviews()` 可能列不出 `add_child` 创建的页面。
pub struct NavigationState {
    pub pages: Mutex<HashMap<String, Webview>>,
    /// 地址栏子 WebView。不放进 `pages`，避免切换标签时被隐藏。
    pub bar: Mutex<Option<Webview>>,
    /// 地址栏左上角。页面被摆到上层之后用来再抬一次。
    pub bar_at: Mutex<Option<(f64, f64)>>,
    /// 下载 URL → 记录 id，完成事件用来对上同一次下载。
    pub downloads: Mutex<HashMap<String, String>>,
}

impl NavigationState {
    pub fn new() -> Self {
        Self {
            pages: Mutex::new(HashMap::new()),
            bar: Mutex::new(None),
            bar_at: Mutex::new(None),
            downloads: Mutex::new(HashMap::new()),
        }
    }
}
