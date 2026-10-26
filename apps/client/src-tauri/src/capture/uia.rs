//! UI Automation 元素链：给选择器提供「比窗口更细」的候选。
//!
//! 两条硬约束：
//! 1. 截屏态下浮层会吃掉命中测试，`ElementFromPoint` 只会返回我们自己的 webview ——
//!    查询前必须临时把浮层切成穿透，查完立刻复原。
//! 2. UIA 是跨进程调用，卡住的应用可能拖住几百毫秒 —— 每次查询都有总预算，超时就用已有的部分。

use std::sync::mpsc::{self, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{POINT, RECT};
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomation2, IUIAutomationElement, IUIAutomationTreeWalker,
};
use windows::core::Interface;

use super::region::OverlayFrame;
use crate::overlay::command::OVERLAY_LABEL;

/// 上溯层数上限（元素 → … → 顶层窗口）
const MAX_DEPTH: usize = 12;
/// 单次查询总预算：超过就用已经拿到的那几层，绝不拖住鼠标
const BUDGET: Duration = Duration::from_millis(250);
/// 单次跨进程调用超时（UIA 默认 2s，对悬停来说太久）
const CONNECTION_TIMEOUT_MS: u32 = 120;

/// 光标下的一个 UI 元素（物理屏幕像素）
pub struct UiElement {
    pub rect: RECT,
    /// 元素所属窗口句柄；非窗口元素为 0
    pub hwnd: isize,
    /// 本地化控件类型（如「按钮」）
    pub control_type: String,
    /// 元素名称（通常是可见文字）
    pub name: String,
}


/// 串行化「临时穿透 + 查询」，避免并发时提前把穿透状态还原
fn probe_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// 查询期间让浮层临时穿透；`Drop` 一定复原 —— 即使调用方 future 被丢弃
/// （命令取消 / 页面卸载），窗口也不会永久停在穿透态。
struct ClickThrough {
    window: tauri::WebviewWindow,
}

impl ClickThrough {
    fn new(window: tauri::WebviewWindow) -> Self {
        let _ = window.set_ignore_cursor_events(true);
        Self { window }
    }
}

impl Drop for ClickThrough {
    fn drop(&mut self) {
        let _ = self.window.set_ignore_cursor_events(false);
    }
}

/// 查询光标下的元素链（由细到粗）。查询期间浮层临时穿透，结束后复原。
pub async fn find_chain_through_overlay(app: &AppHandle, x: f64, y: f64) -> Vec<UiElement> {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return Vec::new();
    };
    let Some(frame) = OverlayFrame::find(app) else {
        return Vec::new();
    };
    let (px, py) = frame.to_physical(x, y);

    let _guard = probe_lock().lock().await;
    // 穿透态只在查询期间存在，且由 guard 负责复原
    tokio::task::spawn_blocking(move || {
        let _click_through = ClickThrough::new(window);
        find_element_chain(px, py)
    })
    .await
    .unwrap_or_default()
}

/// 常驻的 UIA 客户端：COM 对象只在它自己的线程里创建与使用。
///
/// 每次悬停都 `CoCreateInstance` 一次是之前的性能瓶颈（几十毫秒起），
/// 直接用 mpsc 把查询交给专用线程，查询本身降到个位数毫秒。
struct Probe {
    automation: IUIAutomation,
    control: IUIAutomationTreeWalker,
    raw: IUIAutomationTreeWalker,
}

impl Probe {
    fn create() -> Option<Self> {
        // 已初始化时返回 S_FALSE，忽略即可
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let automation: IUIAutomation =
            unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }.ok()?;
        if let Ok(automation2) = automation.cast::<IUIAutomation2>() {
            let _ = unsafe { automation2.SetConnectionTimeout(CONNECTION_TIMEOUT_MS) };
        }
        let control = unsafe { automation.ControlViewWalker() }.ok()?;
        let raw = unsafe { automation.RawViewWalker() }.ok()?;
        Some(Self {
            automation,
            control,
            raw,
        })
    }

    fn probe(&self, x: i32, y: i32) -> Vec<UiElement> {
        let started = Instant::now();
        let Ok(element) = (unsafe { self.automation.ElementFromPoint(POINT { x, y }) }) else {
            return Vec::new();
        };

        let mut chain = self.ascend(&self.control, &element, started);
        // 控制视图太浅（Chromium / Electron 常见）→ 退到原始视图再走一遍，粒度更细
        if chain.len() < 2 {
            let raw = self.ascend(&self.raw, &element, started);
            if raw.len() > chain.len() {
                chain = raw;
            }
        }
        chain
    }

    /// 由细到粗上溯；相邻同矩形只保留最深的一个
    fn ascend(
        &self,
        walker: &IUIAutomationTreeWalker,
        start: &IUIAutomationElement,
        started: Instant,
    ) -> Vec<UiElement> {
        let mut chain: Vec<UiElement> = Vec::with_capacity(MAX_DEPTH);
        let mut current = start.clone();
        for _ in 0..MAX_DEPTH {
            if started.elapsed() > BUDGET {
                break;
            }
            if let Some(entry) = read_element(&current) {
                let duplicated = chain.last().is_some_and(|prev| same_rect(prev.rect, entry.rect));
                if !duplicated {
                    chain.push(entry);
                }
            }
            match unsafe { walker.GetParentElement(&current) } {
                Ok(parent) => current = parent,
                Err(_) => break,
            }
        }
        chain
    }
}

type Job = (i32, i32, Sender<Vec<UiElement>>);

fn worker() -> Option<&'static Sender<Job>> {
    static WORKER: OnceLock<Option<Sender<Job>>> = OnceLock::new();
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            std::thread::Builder::new()
                .name("uia-probe".into())
                .spawn(move || {
                    let probe = Probe::create();
                    while let Ok((x, y, reply)) = rx.recv() {
                        let chain = match probe.as_ref() {
                            Some(probe) => probe.probe(x, y),
                            None => Vec::new(),
                        };
                        let _ = reply.send(chain);
                    }
                })
                .ok()?;
            Some(tx)
        })
        .as_ref()
}

fn find_element_chain(x: i32, y: i32) -> Vec<UiElement> {
    let Some(tx) = worker() else {
        return Vec::new();
    };
    let (reply_tx, reply_rx) = mpsc::channel();
    if tx.send((x, y, reply_tx)).is_err() {
        return Vec::new();
    }
    reply_rx.recv_timeout(BUDGET).unwrap_or_default()
}

fn same_rect(a: RECT, b: RECT) -> bool {
    a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom
}


fn read_element(element: &IUIAutomationElement) -> Option<UiElement> {
    let rect = unsafe { element.CurrentBoundingRectangle() }.ok()?;
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return None;
    }
    let offscreen = unsafe { element.CurrentIsOffscreen() }
        .map(|value| value.as_bool())
        .unwrap_or(false);
    if offscreen {
        return None;
    }
    Some(UiElement {
        rect,
        hwnd: unsafe { element.CurrentNativeWindowHandle() }
            .map(|handle| handle.0 as isize)
            .unwrap_or(0),
        control_type: unsafe { element.CurrentLocalizedControlType() }
            .map(|text| text.to_string())
            .unwrap_or_default(),
        name: unsafe { element.CurrentName() }
            .map(|text| text.to_string())
            .unwrap_or_default(),
    })
}
