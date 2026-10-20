use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Webview;

/// 浏览域共享状态。
///
/// 浏览窗口可以有多个（`browser`、`browser-2`…），页面标签 `page-<id>` 全局唯一，
/// 所以页面本身不必再按窗口分片；「这扇窗口的内容槽 / 浮层 / 待打开地址」这类
/// 每窗口一份的状态一律以窗口 label 为键，窗口之间互不影响。
pub struct NavigationState {
    /// 页面标签（`page-<id>`）→ 子 Webview 强引用。Tauri 的 `webviews()` 可能列不出 `add_child` 创建的页面。
    pub pages: Mutex<HashMap<String, Webview>>,
    /// 页面标签 → 最近一次导航结果。`None` 表示这一次导航还没结束。
    /// 由加载回调写入，切换与恢复时直接读，不再向页面执行脚本探测。
    pub lives: Mutex<HashMap<String, Option<bool>>>,
    /// 窗口 label → 内容槽归属（`Some(页面标签)` = 网页占着，`None` = 留给壳层）。
    pub surfaces: Mutex<HashMap<String, Option<String>>>,
    /// 窗口 label → 地址建议浮层。它是该浏览窗口的 **owned 顶层窗口**：
    /// Windows 保证 owned 窗口永远在 owner 之上，所以它不可能被子 WebView 遮住。
    pub popups: Mutex<HashMap<String, tauri::WebviewWindow>>,
    /// 窗口 label → 刚创建时还收不到事件，先记下要打开的地址，等前端就绪后取走。
    pub pendings: Mutex<HashMap<String, String>>,
    /// 下载 URL → 记录 id，完成事件用来对上同一次下载。
    pub downloads: Mutex<HashMap<String, String>>,
    /// 建窗闸门：`free_browser` 是「先查后建」，并发两次会选中同一个编号。
    pub launch: Mutex<()>,
    /// 建页闸门：`navigation:open` 同样是「先查后建」，并发两次会撞同一个 `page-<id>` 标签。
    pub opening: Mutex<()>,
}

impl NavigationState {
    pub fn new() -> Self {
        Self {
            pages: Mutex::new(HashMap::new()),
            lives: Mutex::new(HashMap::new()),
            surfaces: Mutex::new(HashMap::new()),
            popups: Mutex::new(HashMap::new()),
            pendings: Mutex::new(HashMap::new()),
            downloads: Mutex::new(HashMap::new()),
            launch: Mutex::new(()),
            opening: Mutex::new(()),
        }
    }
}
