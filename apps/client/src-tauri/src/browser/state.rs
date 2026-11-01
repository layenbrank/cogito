//! 浏览器 tab 的运行时状态：Rust 侧是真相源，前端只发起意图。
//!
//! 布局意图照搬 VS Code `BrowserView` 的两个字段（`_wantsVisibility` /
//! `_hasBeenLaidOut`）：第一次拿到真实 rect 之前不 show，否则原生视图会在
//! 左上角闪一下；`wants_visible` 则是前端"我要显示浮层了，你让一下"的开关。

use std::sync::Mutex;

use serde::Serialize;
use uuid::Uuid;

/// 一个浏览器 tab（= 一个 Tauri 子 webview）。
#[derive(Debug, Clone, Serialize)]
pub struct BrowserTab {
    /// Tauri webview label，形如 `browser-<uuid>`（全局唯一，避免 close 残留撞名）
    pub label: String,
    pub url: String,
}

/// 页面自己跳转（点链接 / 重定向）时回传主 webview，地址栏才能跟上。
#[derive(Debug, Clone, Serialize)]
pub struct NavEvent {
    pub label: String,
    pub url: String,
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
