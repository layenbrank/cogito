//! 子 webview 的生命周期：创建、切换、布局、显隐。
//!
//! 层级是这一层的核心约束：原生子 webview 永远盖在主 webview（HTML）之上，
//! 没有任何办法让 HTML 画到它上面。所以策略只有「让位」—— 需要显示浮层时
//! `hide()`，浮层关掉再 `show()`。VS Code 的 `BrowserView` 也是这么做的。

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

use tauri::webview::WebviewBuilder;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Rect, Size, WebviewUrl,
};

use serde_json::json;

use super::state::{BrowserState, BrowserTab, LayoutSnapshot, NavEvent};

/// 主窗口 label（见 `tauri.conf.json`）
const MAIN_WINDOW: &str = "main";

/// 读 `document.title` 写入状态并广播 tabs-changed（失败静默，UI 回退 host）
async fn refresh_tab_title(app: &AppHandle, label: &str) {
    let evaluated = super::cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": "document.title || ''", "returnByValue": true }),
    )
    .await;
    let title = match evaluated {
        Ok(value) => value
            .pointer("/result/value")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_string(),
        Err(error) => {
            log::debug!("browser: 读 title 失败（{label}）: {error}");
            return;
        }
    };
    let Some(state) = app.try_state::<BrowserState>() else {
        return;
    };
    state.set_title(label, title);
    emit_tabs_changed(app, &state);
}

/// 上一次「是否真有 webview 处于可见态」，只用来在切换时打一条日志
static LAST_VISIBLE: AtomicBool = AtomicBool::new(false);

/// 串行化 `add_child`：WebView2 并发创建子 webview 会概率失败（表现为 tab 有了但视图没建起来）
fn open_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn emit_tabs_changed(app: &AppHandle, state: &BrowserState) {
    let snapshot = state.snapshot();
    if let Err(error) = app.emit_to(MAIN_WINDOW, "browser://tabs-changed", &snapshot) {
        log::warn!("browser: 广播 tabs-changed 失败: {error}");
    }
}

/// 让前端重新对齐 tab 状态。
///
/// agent 改了「由 Rust 主导」的字段（当前是设备模拟）后必须广播一次：
/// 前端靠 `tab.device` 才能把工具栏和滚动缩放对齐，否则 UI 会停在旧设备上。
pub fn broadcast(app: &AppHandle, state: &BrowserState) {
    emit_tabs_changed(app, state);
}

/// 状态里有、Tauri 里已经没了的孤儿 tab —— 摘掉并通知前端
fn prune_missing_webviews(app: &AppHandle, state: &BrowserState) -> bool {
    let removed = state.retain_tabs(|tab| app.get_webview(&tab.label).is_some());
    if removed.is_empty() {
        return false;
    }
    for label in &removed {
        log::warn!("browser: 清理孤儿 tab（webview 已不在）：{label}");
        super::picker::dispose_label(app, label);
        super::network::forget(label);
        super::intercept::forget(label);
        super::emulate::forget(label);
    }
    true
}

fn to_rect(snapshot: &LayoutSnapshot) -> Rect {
    Rect {
        position: Position::Logical(LogicalPosition::new(snapshot.layout.x, snapshot.layout.y)),
        size: Size::Logical(LogicalSize::new(
            snapshot.layout.width.max(1.0),
            snapshot.layout.height.max(1.0),
        )),
    }
}

/// 按快照把每个 tab 的 bounds / 可见性刷一遍。
///
/// 只有「活动 tab + 前端希望可见 + 已经拿到过真实 rect」才 show，其余一律 hide。
fn sync(app: &AppHandle, state: &BrowserState) {
    // 先清孤儿，再用最新快照刷 bounds（避免对着幽灵 label 空转）
    let pruned = prune_missing_webviews(app, state);
    let snapshot = state.snapshot();
    let rect = to_rect(&snapshot);
    let mut any_visible = false;
    for tab in &snapshot.tabs {
        let Some(webview) = app.get_webview(&tab.label) else {
            // prune 刚跑过仍缺：极端竞态，下轮再清
            log::warn!("browser: 找不到 webview（{}），跳过同步", tab.label);
            continue;
        };
        let is_active = snapshot.active.as_deref() == Some(tab.label.as_str());
        let visible =
            is_active && snapshot.layout.wants_visible && snapshot.layout.has_been_laid_out;
        any_visible |= visible;

        if visible {
            if let Err(error) = webview.set_bounds(rect) {
                log::warn!("browser: set_bounds 失败（{}）: {error}", tab.label);
            }
            if let Err(error) = webview.show() {
                log::warn!("browser: show 失败（{}）: {error}", tab.label);
            }
        } else if let Err(error) = webview.hide() {
            log::warn!("browser: hide 失败（{}）: {error}", tab.label);
        }
    }

    // 只在状态翻转时打一条：拖动 splitter 会高频 sync，全打会洗掉前面的日志
    if LAST_VISIBLE.swap(any_visible, Ordering::Relaxed) != any_visible {
        log::info!(
            "browser: 可见性 → {any_visible}（rect {},{} {}x{} / active={:?} / laid_out={}）",
            snapshot.layout.x,
            snapshot.layout.y,
            snapshot.layout.width,
            snapshot.layout.height,
            snapshot.active,
            snapshot.layout.has_been_laid_out
        );
    }

    if pruned {
        emit_tabs_changed(app, state);
    }
}

/// 新建 tab 并导航过去。`force_new=false` 时同 host+port 复用已有 tab。
pub fn open(
    app: &AppHandle,
    state: &BrowserState,
    url: &str,
    force_new: bool,
) -> Result<BrowserTab, String> {
    log::info!("browser: 请求打开 {url}（force_new={force_new}）");
    open_inner(app, state, url, force_new)
        .inspect_err(|error| log::warn!("browser: 打开失败: {error}"))
}

fn same_host_port(left: &str, right: &str) -> bool {
    let parse = |value: &str| {
        value
            .parse::<tauri::Url>()
            .ok()
            .map(|parsed| (parsed.host_str().unwrap_or("").to_string(), parsed.port_or_known_default()))
    };
    match (parse(left), parse(right)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

fn open_inner(
    app: &AppHandle,
    state: &BrowserState,
    url: &str,
    force_new: bool,
) -> Result<BrowserTab, String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("URL 不合法：{error}"))?;
    let window = app
        .get_window(MAIN_WINDOW)
        .ok_or_else(|| format!("找不到主窗口 {MAIN_WINDOW}"))?;

    // 串行创建：并发 add_child 在 WebView2 上不稳定
    let _guard = open_lock()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let snapshot = state.snapshot();
    if !force_new {
        if let Some(existing) = snapshot
            .tabs
            .iter()
            .find(|tab| same_host_port(&tab.url, &parsed.to_string()))
        {
            let label = existing.label.clone();
            log::info!("browser: 复用同 host tab {label} → {url}");
            navigate(app, state, &label, url)?;
            activate(app, state, &label)?;
            return state
                .tab(&label)
                .ok_or_else(|| format!("复用 tab 后丢失：{label}"));
        }
    }
    let width = snapshot.layout.width.max(1.0);
    let height = snapshot.layout.height.max(1.0);

    // 尺寸完全由前端上报的 rect 决定，不跟随父窗口自动缩放
    //
    // ⚠️ 不要调 `data_directory` / `additional_browser_args`：
    // Tauri 按 data_directory 缓存 WebView2 environment，保持默认才能让所有 tab
    // 共用同一个 profile（cookie / localStorage 按 origin 共享，和浏览器一致）。
    let mut last_error = String::from("创建浏览器视图失败");
    // UUID 几乎不撞名；仍允许一次换新 label 重试，覆盖极端残留
    for attempt in 0..2 {
        let label = state.next_label();
        let handle = app.clone();
        let load_label = label.clone();
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed.clone()))
            // WebView2 的默认右键菜单不含「检查」，而主窗口那边 `native_find` 把
            // `AreBrowserAcceleratorKeysEnabled` 关了（连 F12 一起），所以子 webview
            // 必须显式开 devtools，否则这个 tab 上没有任何入口能打开控制台。
            .devtools(true)
            .on_page_load(move |_webview, payload| {
                let url = payload.url().to_string();
                // 页面自己跳转（点链接 / 重定向）时这里才会触发，地址栏靠它跟上真实地址
                if let Some(browser) = handle.try_state::<BrowserState>() {
                    browser.set_url(&load_label, url.clone());
                }
                if let Err(error) = handle.emit_to(
                    MAIN_WINDOW,
                    "browser://nav",
                    NavEvent {
                        label: load_label.clone(),
                        url: url.clone(),
                        title: String::new(),
                    },
                ) {
                    log::warn!("browser: 导航事件发送失败: {error}");
                }

                // 硬导航会重置 CDP 的 per-target override。设备档案存在 Rust 里，
                // 所以每次 load 完都重放一次（桌面态是个空操作，代价只有一次查表）。
                let replay_handle = handle.clone();
                let replay_label = load_label.clone();
                tauri::async_runtime::spawn(async move {
                    super::emulate::replay(&replay_handle, &replay_label).await;
                });

                // 读 document.title 写入状态，供 composer / aside / prompt 展示
                let title_handle = handle.clone();
                let title_label = load_label.clone();
                tauri::async_runtime::spawn(async move {
                    refresh_tab_title(&title_handle, &title_label).await;
                });
            });

        let created = window.add_child(
            builder,
            LogicalPosition::new(snapshot.layout.x, snapshot.layout.y),
            LogicalSize::new(width, height),
        );

        let webview = match created {
            Ok(webview) => webview,
            Err(error) => {
                last_error = format!("创建浏览器视图失败：{error}");
                log::warn!(
                    "browser: add_child 失败（attempt {}, label={label}）: {error}",
                    attempt + 1
                );
                continue;
            }
        };

        // 先藏起来，等 activate + layout 一起放出来（避免在错位置闪一下）
        if let Err(error) = webview.hide() {
            log::warn!("browser: 新 tab 初始 hide 失败（{label}）: {error}");
        }

        // 双检：个别情况下 add_child 返回成功但 get_webview 立刻拿不到
        if app.get_webview(&label).is_none() {
            last_error = format!("创建浏览器视图后立刻丢失（{label}）");
            log::warn!("browser: {last_error}");
            let _ = webview.close();
            continue;
        }

        let tab = BrowserTab {
            label: label.clone(),
            url: parsed.to_string(),
            title: String::new(),
            device: None,
        };
        log::info!(
            "browser: 新建 {label} → {url}（rect {}x{} @ {},{} / laid_out={}）",
            snapshot.layout.width,
            snapshot.layout.height,
            snapshot.layout.x,
            snapshot.layout.y,
            snapshot.layout.has_been_laid_out
        );
        state.insert(tab.clone());
        state.activate(&label);
        sync(app, state);
        super::network::install(app, &label);
        emit_tabs_changed(app, state);
        return Ok(tab);
    }

    Err(last_error)
}

/// 关闭 tab（webview 会被销毁）。
pub fn close(app: &AppHandle, state: &BrowserState, label: &str) -> Result<(), String> {
    let Some(tab) = state.remove(label) else {
        return Err(format!("没有这个 tab：{label}"));
    };
    super::picker::dispose_label(app, &tab.label);
    if let Some(webview) = app.get_webview(&tab.label) {
        if let Err(error) = webview.close() {
            log::warn!("browser: 关闭 webview 失败（{}）: {error}", tab.label);
        }
    }
    // UUID label 虽不复用，仍清网络/拦截/设备，避免内存涨
    super::network::forget(&tab.label);
    super::intercept::forget(&tab.label);
    super::emulate::forget(&tab.label);
    sync(app, state);
    emit_tabs_changed(app, state);
    Ok(())
}

/// 切活动 tab：其余全部隐藏，目标 tab 按当前布局显示。
pub fn activate(app: &AppHandle, state: &BrowserState, label: &str) -> Result<(), String> {
    if !state.activate(label) {
        return Err(format!("没有这个 tab：{label}"));
    }
    sync(app, state);
    Ok(())
}

/// 上报内容区 rect（逻辑像素，相对窗口客户区）。
pub fn layout(
    app: &AppHandle,
    state: &BrowserState,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let first_layout = !state.snapshot().layout.has_been_laid_out;
    state.set_layout(x, y, width, height);
    if first_layout {
        log::info!("browser: 首次上报 rect {x},{y} {width}x{height}");
    }
    sync(app, state);
    Ok(())
}

/// 前端要弹浮层 / 切走页签时让位；`true` 表示可以显示浏览器。
pub fn set_visible(app: &AppHandle, state: &BrowserState, visible: bool) -> Result<(), String> {
    log::info!("browser: wants_visible={visible}");
    state.set_visible(visible);
    sync(app, state);
    Ok(())
}

/// 导航到新地址（同一个 tab）。
pub fn navigate(
    app: &AppHandle,
    state: &BrowserState,
    label: &str,
    url: &str,
) -> Result<(), String> {
    let parsed = url
        .parse::<tauri::Url>()
        .map_err(|error| format!("URL 不合法：{error}"))?;
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    log::info!("browser: 导航 {label} → {parsed}");
    // 导航会卸页面，拾取态必须清掉
    super::picker::dispose_label(app, label);
    webview
        .navigate(parsed.clone())
        .map_err(|error| format!("导航失败：{error}"))?;
    state.set_url(label, parsed.to_string());
    Ok(())
}

/// 截图前临时把 webview 显示出来。
///
/// 前端可能正停在聊天视图，或者正在浮层让位 —— 这种情况下 WebView2 的
/// `captureScreenshot` 会返回**空对象**而不是报错。返回 `true` 表示真的做了显示，
/// 调用方用完必须调 `hide_after_capture` 收回。
///
/// 刻意不经过 `BrowserState`：`wants_visible` / `active` 表达的是前端意图，不能因为我们
/// 要截一张图就把它改掉。非活跃 tab 同样允许临时 show（agent 按 label 截图）。
pub fn reveal_for_capture(app: &AppHandle, label: &str) -> bool {
    let Some(webview) = app.get_webview(label) else {
        return false;
    };
    let state = app.state::<BrowserState>();
    let snapshot = state.snapshot();
    if !snapshot.tabs.iter().any(|tab| tab.label == label) {
        return false;
    }
    if !snapshot.layout.has_been_laid_out {
        return false;
    }
    // 活动 tab 且前端本就可见：无需再 reveal
    if snapshot.active.as_deref() == Some(label) && snapshot.layout.wants_visible {
        return false;
    }

    if let Err(error) = webview.set_bounds(to_rect(&snapshot)) {
        log::warn!("browser: 截图前 set_bounds 失败（{label}）: {error}");
        return false;
    }
    if let Err(error) = webview.show() {
        log::warn!("browser: 截图前 show 失败（{label}）: {error}");
        return false;
    }
    true
}

/// 配合 `reveal_for_capture`：拍完立刻收回，不留给用户一个突然出现的页面
pub fn hide_after_capture(app: &AppHandle, label: &str) {
    if let Some(webview) = app.get_webview(label) {
        if let Err(error) = webview.hide() {
            log::warn!("browser: 截图后收回失败（{label}）: {error}");
        }
    }
}

/// 前端 / agent 需要知道"当前在哪个页面"。
pub fn current_url(app: &AppHandle, label: &str) -> Result<String, String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    webview
        .url()
        .map(|url| url.to_string())
        .map_err(|error| format!("读取当前地址失败：{error}"))
}

/// 打开这个 tab 的 DevTools（独立窗口，所以不受原生 subview 层级影响）。
pub fn open_devtools(app: &AppHandle, label: &str) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    webview.open_devtools();
    Ok(())
}

/// 刷新当前页面。
pub fn reload(app: &AppHandle, label: &str) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    webview
        .reload()
        .map_err(|error| format!("刷新失败：{error}"))
}

/// 前进 / 后退。
///
/// Tauri 没暴露历史导航 API，只能在**页面自己**跑 `history.back/forward()`。
/// 脚本是常量，不接受任何外部输入 —— 和后面给 agent 用的 `eval` 逃生口不是一回事。
pub fn step_history(app: &AppHandle, label: &str, backward: bool) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    let script = if backward {
        "history.back()"
    } else {
        "history.forward()"
    };
    webview
        .eval(script)
        .map_err(|error| format!("历史导航失败：{error}"))
}
