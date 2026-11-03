//! 浏览器 tab 的运行时状态：Rust 侧是真相源，前端只发起意图。
//!
//! 布局意图照搬 VS Code `BrowserView` 的两个字段（`_wantsVisibility` /
//! `_hasBeenLaidOut`）：第一次拿到真实 rect 之前不 show，否则原生视图会在
//! 左上角闪一下；`wants_visible` 则是前端"我要显示浮层了，你让一下"的开关。

use std::sync::Mutex;

use serde::Serialize;
use uuid::Uuid;

use super::emulate::DeviceProfile;

/// 一个浏览器 tab（= 一个 Tauri 子 webview）。
#[derive(Debug, Clone, Serialize)]
pub struct BrowserTab {
    /// Tauri webview label，形如 `browser-<uuid>`（全局唯一，避免 close 残留撞名）
    pub label: String,
    pub url: String,
    /// `document.title`；空串表示尚未读到（UI 回退 host）
    #[serde(default)]
    pub title: String,
    /// 这个 tab 的设备模拟档案；`None` = 桌面态（= `app_browser_device` 的 off）。
    ///
    /// 放在 tab 上是刻意的：`browser_snapshot` 会原样带回前端，页面刷新 / HMR 后
    /// UI 的「当前设备」不会丢，也不需要前端另开一条拉取通道。
    pub device: Option<DeviceProfile>,
}

/// 页面自己跳转时回传主 webview，地址栏才能跟上。
///
/// `same_document`：SPA `pushState` / hash 等同文档变更；硬导航为 false。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavEvent {
    pub label: String,
    pub url: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub same_document: bool,
}

/// 布局意图。
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// 至少收到过一次真实 rect
    pub has_been_laid_out: bool,
    /// 前端期望可见；浮层打开时置 false 让位
    pub wants_visible: bool,
}

/// 一次同步需要的全量快照：tabs + 活动 label + 布局，一次加锁取全。
///
/// 也直接作为 `browser_snapshot` 的返回值：前端页面刷新（HMR / 重新加载）后
/// 内存态全丢，但 Rust 里的 webview 还活着，就靠它回灌。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSnapshot {
    pub tabs: Vec<BrowserTab>,
    pub active: Option<String>,
    pub layout: Layout,
}

#[derive(Debug, Default)]
pub struct BrowserState {
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    tabs: Vec<BrowserTab>,
    active: Option<String>,
    layout: Layout,
}

impl BrowserState {
    /// 锁被毒化也继续用里面的值：这只是渲染状态，没有"半写坏"的中间态值得放弃
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// 新 tab 的 webview label：UUID，不复用序号，杜绝 close 失败残留导致 add_child 撞名
    pub fn next_label(&self) -> String {
        format!("browser-{}", Uuid::new_v4())
    }

    pub fn insert(&self, tab: BrowserTab) {
        self.lock().tabs.push(tab);
    }

    /// 移除并返回；被移除的是活动 tab 时，活动位顺延到剩下最后一个
    pub fn remove(&self, label: &str) -> Option<BrowserTab> {
        let mut inner = self.lock();
        let index = inner.tabs.iter().position(|tab| tab.label == label)?;
        let removed = inner.tabs.remove(index);
        if inner.active.as_deref() == Some(label) {
            inner.active = inner.tabs.last().map(|tab| tab.label.clone());
        }
        Some(removed)
    }

    /// 按谓词批量摘掉孤儿 tab，返回被摘掉的 label
    pub fn retain_tabs(&self, mut keep: impl FnMut(&BrowserTab) -> bool) -> Vec<String> {
        let mut inner = self.lock();
        let mut removed = Vec::new();
        inner.tabs.retain(|tab| {
            if keep(tab) {
                true
            } else {
                removed.push(tab.label.clone());
                false
            }
        });
        if let Some(active) = inner.active.clone() {
            if removed.iter().any(|label| label == &active) {
                inner.active = inner.tabs.last().map(|tab| tab.label.clone());
            }
        }
        removed
    }

    pub fn activate(&self, label: &str) -> bool {
        let mut inner = self.lock();
        if !inner.tabs.iter().any(|tab| tab.label == label) {
            return false;
        }
        inner.active = Some(label.to_string());
        true
    }

    pub fn set_url(&self, label: &str, url: String) {
        let mut inner = self.lock();
        if let Some(tab) = inner.tabs.iter_mut().find(|tab| tab.label == label) {
            tab.url = url;
            // 硬导航会换文档，旧标题作废
            tab.title.clear();
        }
    }

    /// 同文档 URL 变更（SPA）：保留 title，避免地址栏同步时闪成 host。
    pub fn set_url_same_document(&self, label: &str, url: String) {
        let mut inner = self.lock();
        if let Some(tab) = inner.tabs.iter_mut().find(|tab| tab.label == label) {
            tab.url = url;
        }
    }

    pub fn set_title(&self, label: &str, title: String) {
        let mut inner = self.lock();
        if let Some(tab) = inner.tabs.iter_mut().find(|tab| tab.label == label) {
            tab.title = title;
        }
    }

    /// 同 host+port 的已有 tab（`app_browser_open` 默认复用）
    pub fn find_by_host_port(&self, host: &str, port: u16) -> Option<BrowserTab> {
        self.lock()
            .tabs
            .iter()
            .find(|tab| match host_port_of(&tab.url) {
                Some((tab_host, tab_port)) => tab_host == host && tab_port == port,
                None => false,
            })
            .cloned()
    }

    /// 单个 tab 的快照（设备模拟要读它，导航重放也靠它）
    pub fn tab(&self, label: &str) -> Option<BrowserTab> {
        self.lock()
            .tabs
            .iter()
            .find(|tab| tab.label == label)
            .cloned()
    }

    /// 记录设备档案；`None` = 退出模拟。返回 tab 是否存在。
    ///
    /// 只改状态，不下发 CDP —— 应用覆盖由 `emulate::apply` 负责，
    /// 这样「切设备」与「导航后重放」共用同一条路径。
    pub fn set_device(&self, label: &str, device: Option<DeviceProfile>) -> bool {
        let mut inner = self.lock();
        match inner.tabs.iter_mut().find(|tab| tab.label == label) {
            Some(tab) => {
                tab.device = device;
                true
            }
            None => false,
        }
    }

    /// 记录新 rect；`has_been_laid_out` 一旦为真就不再回退
    pub fn set_layout(&self, x: f64, y: f64, width: f64, height: f64) {
        let mut inner = self.lock();
        inner.layout = Layout {
            x,
            y,
            width,
            height,
            has_been_laid_out: true,
            wants_visible: inner.layout.wants_visible,
        };
    }

    pub fn set_visible(&self, visible: bool) {
        self.lock().layout.wants_visible = visible;
    }

    pub fn snapshot(&self) -> LayoutSnapshot {
        let inner = self.lock();
        LayoutSnapshot {
            tabs: inner.tabs.clone(),
            active: inner.active.clone(),
            layout: inner.layout,
        }
    }
}

/// `(host, port)`；无 host / 未知默认端口时返回 `None`（不可复用比对）
fn host_port_of(url: &str) -> Option<(String, u16)> {
    let parsed = url.parse::<url::Url>().ok()?;
    let host = parsed.host_str()?.to_string();
    let port = parsed.port_or_known_default()?;
    Some((host, port))
}

/// 解析 URL 的 host+port，供 `app_browser_open` 复用比对
pub fn parse_host_port(url: &str) -> Option<(String, u16)> {
    host_port_of(url)
}
