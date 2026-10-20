use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    Position, Size, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use uuid::Uuid;

use crate::navigation::state::NavigationState;

const PAGE_PREFIX: &str = "page-";
/// 浏览窗口的基础 label；第二扇起是 `browser-2`、`browser-3`…（编号会被回收复用）。
const BROWSER: &str = "browser";
const BROWSER_PREFIX: &str = "browser-";
/// 地址建议浮层的 label 前缀。每扇浏览窗口一个浮层：`navigation-popup-browser-2`。
const POPUP_PREFIX: &str = "navigation-popup-";
/// 浮层与主壳共用同一个入口，靠 webview label 在渲染层分流。
const POPUP_PAGE: &str = "index.html";
const OPEN_URL_MARK: &str = "i-thinking:open-url:";
/// 网页里的 Ctrl/⌘ + 浏览快捷键。网页跑在独立子 WebView 里，壳层收不到它的按键，
/// 所以由注入脚本拦住这几键再转给宿主。
const SHORTCUT_MARK: &str = "i-thinking:shortcut:";

/// 宿主桥脚本：在 WebView2 处理点击/按键之前把「要开新窗口」与「浏览快捷键」交给宿主。
/// `postMessage` 成功后才取消默认动作，避免只吞掉点击。
const BRIDGE_SCRIPT: &str = r#"(function () {
  var openMark = "i-thinking:open-url:"
  var keyMark = "i-thinking:shortcut:"
  function bridge() {
    return window.chrome && window.chrome.webview && window.chrome.webview.postMessage
  }
  function classify(raw) {
    try {
      var url = new URL(raw, document.baseURI)
      if (url.protocol === "http:" || url.protocol === "https:") return { kind: "http", href: url.href }
      return { kind: "other" }
    } catch (err) {
      return { kind: "other" }
    }
  }
  function send(raw) {
    var parsed = classify(raw)
    if (parsed.kind !== "http") return parsed.kind
    if (!bridge()) return "skip"
    window.chrome.webview.postMessage(openMark + parsed.href)
    return "sent"
  }
  function isNewTarget(target) {
    var name = (target || "").toLowerCase()
    return name !== "" && name !== "_self" && name !== "_parent" && name !== "_top"
  }
  document.addEventListener("click", function (event) {
    var node = event.target && event.target.closest ? event.target.closest("a") : null
    if (!node) return
    var blank = isNewTarget(node.getAttribute("target")) || event.button === 1 || event.ctrlKey || event.metaKey || event.shiftKey
    if (!blank) return
    var result = send(node.href)
    if (result === "sent" || result === "other") {
      event.preventDefault()
      event.stopPropagation()
    }
  }, true)
  document.addEventListener("submit", function (event) {
    var form = event.target
    if (!form || form.nodeName !== "FORM" || !isNewTarget(form.getAttribute("target"))) return
    var action = form.getAttribute("action") || document.baseURI
    var result = send(action)
    if (result === "sent" || result === "other") {
      event.preventDefault()
      event.stopPropagation()
    }
  }, true)
  document.addEventListener("keydown", function (event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
    var key = (event.key || "").toLowerCase()
    if (key !== "t" && key !== "w" && key !== "l" && key !== "n") return
    if (!bridge()) return
    event.preventDefault()
    event.stopPropagation()
    window.chrome.webview.postMessage(keyMark + key)
  }, true)
  var nativeOpen = window.open
  window.open = function (url) {
    if (typeof url !== "string") return nativeOpen.apply(window, arguments)
    var result = send(url)
    if (result === "sent" || result === "other") return null
    return nativeOpen.apply(window, arguments)
  }
})()"#;

/// 浏览窗口的 label（`browser` / `browser-2`…）→ 序号；其它窗口返回 `None`。
pub(crate) fn browser_index(label: &str) -> Option<u32> {
    if label == BROWSER {
        return Some(1);
    }
    label.strip_prefix(BROWSER_PREFIX)?.parse().ok()
}

pub(crate) fn is_browser(label: &str) -> bool {
    browser_index(label).is_some()
}

fn browser_label(index: u32) -> String {
    if index <= 1 {
        BROWSER.to_string()
    } else {
        format!("{BROWSER_PREFIX}{index}")
    }
}

/// 第一个空出来的编号。关闭窗口后编号会被复用，所以创建前必须先清掉同名残留。
fn free_browser(app: &AppHandle) -> String {
    let mut index = 1;
    loop {
        let label = browser_label(index);
        if app.get_webview_window(&label).is_none() {
            return label;
        }
        index += 1;
    }
}

/// 已有浏览窗口：聚焦中的优先，否则编号最大的（最近打开的那扇）。
fn find_browser(app: &AppHandle) -> Option<WebviewWindow> {
    let mut windows: Vec<(u32, WebviewWindow)> = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, window)| browser_index(&label).map(|index| (index, window)))
        .collect();
    if let Some((_, window)) = windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
    {
        return Some(window.clone());
    }
    windows.sort_by_key(|(index, _)| *index);
    windows.pop().map(|(_, window)| window)
}

/// 网页与地址建议浮层只能挂在浏览窗口上；工作台窗口不承载网页。
fn require_browser(window: &tauri::Window) -> Result<(), String> {
    if is_browser(window.label()) {
        Ok(())
    } else {
        Err("网址页面只能挂在浏览窗口".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundsBody {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenBody {
    id: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdBody {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigateBody {
    id: String,
    url: Option<String>,
    direction: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum ExtensionsBody {
    Read,
    Import { path: String },
    Remove { name: String },
}

#[derive(Clone, Serialize)]
struct OpenUrlPayload {
    url: String,
}

#[derive(Clone, Serialize)]
struct ShortcutPayload {
    key: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PagePayload {
    id: String,
    url: String,
}

/// 子 WebView 这一次导航是否成功。`ok == false` 表示页面已经打开但没有加载成功。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadPayload {
    id: String,
    ok: bool,
}

/// `navigation:open` 返回时页面是否已经有结果。`None` 表示这一次导航还没结束。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenResult {
    ok: Option<bool>,
}

/// 上游 `PageLoadEvent` 还没有成功与否。Windows 在 Finished 回调里给出 `IsSuccess`，其余情况只看地址。
fn finish_ok(url: &str, reported: Option<bool>) -> bool {
    if let Some(ok) = reported {
        return ok;
    }
    url.starts_with("http://") || url.starts_with("https://")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitlePayload {
    id: String,
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadPayload {
    id: String,
    url: String,
    name: String,
    status: String,
    path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsResult {
    names: Vec<String>,
    supported: bool,
}

pub(crate) fn page_label(id: &str) -> String {
    format!("{PAGE_PREFIX}{id}")
}

pub(crate) fn page_id(label: &str) -> String {
    label.strip_prefix(PAGE_PREFIX).unwrap_or(label).to_string()
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
}

pub(crate) fn parse_http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|err| err.to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err("只支持 http / https".to_string()),
    }
}

/// `target=_blank` / `window.open` 的地址。只把 http/https 交给侧栏开「网址」标签，其余协议直接丢掉。
fn emit_blank_url(app: &AppHandle, shell: &str, url: &Url) {
    let Ok(parsed) = parse_http_url(url.as_str()) else {
        return;
    };
    emit_shell(
        app,
        shell,
        "navigation://open-url",
        OpenUrlPayload {
            url: parsed.to_string(),
        },
    );
}

pub(crate) fn emit_shell<S: Serialize + Clone>(app: &AppHandle, label: &str, event: &str, payload: S) {
    let _ = app.emit_to(label, event, payload);
}

pub(crate) fn profile_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("navigation-profile");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

pub(crate) fn extensions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("extensions");
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir)
}

pub(crate) fn download_dir(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .download_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn list_extensions(dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.path().is_dir()
            && let Some(name) = entry.file_name().to_str()
        {
            names.push(name.to_string());
        }
    }
    names.sort();
    Ok(names)
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|err| err.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target).map_err(|err| err.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn file_name_from_url(url: &Url) -> String {
    let raw = url
        .path_segments()
        .and_then(|segments| segments.filter(|part| !part.is_empty()).last())
        .unwrap_or("download");
    let decoded = urlencoding_or_raw(raw);
    let safe: String = decoded
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() || safe == "." || safe == ".." {
        "download".to_string()
    } else {
        safe
    }
}

fn urlencoding_or_raw(raw: &str) -> String {
    percent_decode(raw).unwrap_or_else(|| raw.to_string())
}

fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub(crate) fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let ext = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for index in 1..1000 {
        let next = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        let path = dir.join(next);
        if !path.exists() {
            return path;
        }
    }
    dir.join(format!("{stem}-{}", Uuid::new_v4()))
}

fn place(webview: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    webview
        .set_bounds(tauri::Rect {
            position: Position::Logical(LogicalPosition::new(x, y)),
            size: Size::Logical(LogicalSize::new(width.max(1.0), height.max(1.0))),
        })
        .map_err(|err| err.to_string())
}

/// 只认属于这扇窗口的页面：多窗口并存时不能把别人的页面摆进自己的内容槽。
fn find_page(state: &NavigationState, shell: &str, id: &str) -> Result<tauri::Webview, String> {
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    let webview = pages
        .get(&page_label(id))
        .cloned()
        .ok_or_else(|| "页面不存在".to_string())?;
    if webview.window().label() != shell {
        return Err("页面不属于当前窗口".to_string());
    }
    Ok(webview)
}

/// 收起某扇窗口名下的页面；`keep` 指定的页面保持原样（切换时目标页不能被藏一下再显示）。
fn hide_pages(state: &NavigationState, shell: &str, keep: Option<&str>) -> Result<(), String> {
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    for (label, page) in pages.iter() {
        if keep == Some(label.as_str()) || page.window().label() != shell {
            continue;
        }
        let _ = page.hide();
    }
    Ok(())
}

fn set_surface(state: &NavigationState, shell: &str, value: Option<String>) -> Result<(), String> {
    state
        .surfaces
        .lock()
        .map_err(|err| err.to_string())?
        .insert(shell.to_string(), value);
    Ok(())
}

/// 窗口销毁后清掉它名下的引用。label 会被复用，残留句柄会让下一扇同编号窗口拿到已销毁的页面。
pub(crate) fn prune(app: &AppHandle, shell: &str) {
    let Some(state) = app.try_state::<NavigationState>() else {
        return;
    };
    prune_space(&state, shell);
}

fn prune_space(state: &NavigationState, shell: &str) {
    let stale: Vec<String> = {
        let Ok(mut pages) = state.pages.lock() else {
            return;
        };
        let stale: Vec<String> = pages
            .iter()
            .filter(|(_, page)| page.window().label() == shell)
            .map(|(label, _)| label.clone())
            .collect();
        for label in &stale {
            pages.remove(label);
        }
        stale
    };
    if let Ok(mut lives) = state.lives.lock() {
        for label in &stale {
            lives.remove(label);
        }
    }
    if let Ok(mut surfaces) = state.surfaces.lock() {
        surfaces.remove(shell);
    }
    if let Ok(mut popups) = state.popups.lock() {
        popups.remove(shell);
    }
    if let Ok(mut pendings) = state.pendings.lock() {
        pendings.remove(shell);
    }
}

/// 记下这次导航是否成功。切走只隐藏 WebView，关闭才销毁，所以结果要单独报给侧栏。
#[cfg(windows)]
fn watch_load(webview: &tauri::Webview, app: AppHandle, shell: String) {
    let app_for_external = app.clone();
    let shell_external = shell.clone();
    let watched = webview.with_webview(move |platform| {
        if let Err(err) = bind_external(&platform, app_for_external, shell_external) {
            log::warn!("[navigation] 监听外部协议失败: {err}");
        }
        if let Err(err) = bind_open_url(platform, app, shell) {
            log::warn!("[navigation] 监听页内新窗口失败: {err}");
        }
    });
    if let Err(err) = watched {
        log::warn!("[navigation] 挂接页面事件失败: {err}");
    }
}

/// 自定义协议交给系统打开时，WebView2 不走 NewWindowRequested。取消外跳，http/https 仍收进侧栏。
#[cfg(windows)]
fn bind_external(
    platform: &tauri::webview::PlatformWebview,
    app: AppHandle,
    shell: String,
) -> windows::core::Result<()> {
    use webview2_com::LaunchingExternalUriSchemeEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_18;
    use windows::core::{Interface, PWSTR};

    let core = unsafe { platform.controller().CoreWebView2() }?;
    let core = core.cast::<ICoreWebView2_18>()?;
    let handler = LaunchingExternalUriSchemeEventHandler::create(Box::new(move |_view, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut raw = PWSTR::null();
        unsafe { args.Uri(&mut raw)? };
        let uri = read_pwstr(raw);
        unsafe { args.SetCancel(true)? };
        if let Ok(url) = Url::parse(&uri) {
            emit_blank_url(&app, &shell, &url);
        }
        Ok(())
    }));
    let mut token = 0_i64;
    unsafe { core.add_LaunchingExternalUriScheme(&handler, &mut token) }
}

/// 页面脚本在取消点击/按键之前送来的宿主消息：新窗口地址，或要落的浏览快捷键。
#[cfg(windows)]
fn bind_open_url(
    platform: tauri::webview::PlatformWebview,
    app: AppHandle,
    shell: String,
) -> windows::core::Result<()> {
    use webview2_com::WebMessageReceivedEventHandler;
    use windows::core::PWSTR;

    let core = unsafe { platform.controller().CoreWebView2() }?;
    let handler = WebMessageReceivedEventHandler::create(Box::new(move |_view, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut raw = PWSTR::null();
        if unsafe { args.TryGetWebMessageAsString(&mut raw) }.is_err() {
            return Ok(());
        }
        let message = read_pwstr(raw);
        if let Some(key) = message.strip_prefix(SHORTCUT_MARK) {
            emit_shell(
                &app,
                &shell,
                "navigation://shortcut",
                ShortcutPayload {
                    key: key.to_string(),
                },
            );
            return Ok(());
        }
        let Some(url) = message.strip_prefix(OPEN_URL_MARK) else {
            return Ok(());
        };
        if let Ok(parsed) = Url::parse(url) {
            emit_blank_url(&app, &shell, &parsed);
        }
        Ok(())
    }));
    let mut token = 0_i64;
    unsafe { core.add_WebMessageReceived(&handler, &mut token) }
}

#[cfg(windows)]
fn read_pwstr(ptr: windows::core::PWSTR) -> String {
    use windows::Win32::System::Com::CoTaskMemFree;
    if ptr.is_null() {
        return String::new();
    }
    let text = unsafe { ptr.to_string() }.unwrap_or_default();
    unsafe { CoTaskMemFree(Some(ptr.as_ptr().cast())) };
    text
}

#[cfg(not(windows))]
fn watch_load(_webview: &tauri::Webview, _app: AppHandle, _shell: String) {}

/// 壳页面刷新后，子 WebView 还在，但前端状态已经丢了。把每个还在的页面当前结果交回去。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LivePage {
    id: String,
    ok: Option<bool>,
}

#[tauri::command(rename = "navigation:read-lives")]
pub async fn navigation_read_lives(
    window: tauri::Window,
    state: State<'_, NavigationState>,
) -> Result<Vec<LivePage>, String> {
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    let lives = state.lives.lock().map_err(|err| err.to_string())?;
    Ok(pages
        .iter()
        .filter(|(_, page)| page.window().label() == window.label())
        .map(|(label, _)| LivePage {
            id: page_id(label),
            ok: lives.get(label).copied().flatten(),
        })
        .collect())
}

/// 创建远程子 Webview。Windows 上必须在异步命令里调用，避免和 WebView2 死锁。
#[tauri::command(rename = "navigation:open")]
pub async fn navigation_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: OpenBody,
) -> Result<OpenResult, String> {
    require_browser(&window)?;
    if !is_safe_id(&body.id) {
        return Err("页面 id 无效".to_string());
    }
    let url = parse_http_url(&body.url)?;
    let label = page_label(&body.id);
    // 「先查后建」必须串行：挂载恢复与点标签可能同时进来，两次选中同一个 `page-<id>`，
    // 后一个 `add_child` 会失败于 `already exists`。
    let _gate = state.opening.lock().map_err(|err| err.to_string())?;
    let live = {
        let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
        if let Some(page) = pages.get(&label) {
            if page.window().label() == window.label() {
                Some(page.clone())
            } else if let Some(stale) = pages.remove(&label) {
                drop(pages);
                let _ = stale.close();
                None
            } else {
                None
            }
        } else {
            None
        }
    };
    if live.is_some() {
        let ok = state
            .lives
            .lock()
            .map_err(|err| err.to_string())?
            .get(&label)
            .copied()
            .flatten();
        return Ok(OpenResult { ok });
    }
    // 上一次创建中途失败、或壳层重建过：Tauri 里可能还留着一个同名 WebView。
    // 直接接管它，而不是再 `add_child` 一次（那必然报 `already exists`）。
    if let Some(existing) = app.get_webview(&label) {
        if existing.window().label() != window.label() {
            return Err("同一个页面已经被其它窗口占用".to_string());
        }
        let ok = {
            let mut lives = state.lives.lock().map_err(|err| err.to_string())?;
            lives.entry(label.clone()).or_insert(None);
            lives.get(&label).copied().flatten()
        };
        // 接管的页面可能停在别的地址（上一轮遗留）：按这次要打开的地址纠正。
        if existing.url().is_ok_and(|current| current != url) {
            let _ = existing.navigate(url);
        }
        state
            .pages
            .lock()
            .map_err(|err| err.to_string())?
            .insert(label, existing);
        return Ok(OpenResult { ok });
    }

    let shell = window.label().to_string();
    let profile = profile_dir(&app)?;
    let extensions = extensions_dir(&app)?;
    let download_root = download_dir(&app);
    let app_for_download = app.clone();
    let app_for_title = app.clone();
    let app_for_load = app.clone();
    let app_for_blank = app.clone();

    let shell_title = shell.clone();
    let shell_load = shell.clone();
    let shell_download = shell.clone();
    let shell_finished = shell.clone();
    let shell_blank = shell.clone();
    // 先占位再建页：加载回调可能在 `add_child` 返回前就写结果。
    if let Ok(mut lives) = state.lives.lock() {
        lives.insert(label.clone(), None);
    }

    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(profile)
        .initialization_script_for_all_frames(BRIDGE_SCRIPT)
        .on_document_title_changed(move |webview, title| {
            emit_shell(
                &app_for_title,
                &shell_title,
                "navigation://title",
                TitlePayload {
                    id: page_id(webview.label()),
                    title,
                },
            );
        })
        .on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            let id = page_id(webview.label());
            let url = payload.url().to_string();
            let ok = finish_ok(&url, wry::page_load_succeeded());
            if let Some(state) = app_for_load.try_state::<NavigationState>()
                && let Ok(mut lives) = state.lives.lock()
                // 只写回还活着的页面：关闭时已把条目删掉，不能因为回调晚到又长回来。
                && let Some(slot) = lives.get_mut(webview.label())
            {
                *slot = Some(ok);
            }
            emit_shell(
                &app_for_load,
                &shell_load,
                "navigation://view",
                PagePayload {
                    id: id.clone(),
                    url,
                },
            );
            emit_shell(
                &app_for_load,
                &shell_load,
                "navigation://load",
                LoadPayload { id, ok },
            );
        })
        .on_new_window(move |url, _features| {
            // Deny 让补丁后的 wry 保持 Handled=true，避免延后闭包再 SetHandled(false) 把系统浏览器放出来。
            emit_blank_url(&app_for_blank, &shell_blank, &url);
            NewWindowResponse::Deny
        })
        .on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                let name = file_name_from_url(&url);
                let path = unique_destination(&download_root, &name);
                let id = Uuid::new_v4().to_string();
                if let Some(state) = app_for_download.try_state::<NavigationState>()
                    && let Ok(mut downloads) = state.downloads.lock()
                {
                    downloads.insert(url.to_string(), id.clone());
                }
                emit_shell(
                    &app_for_download,
                    &shell_download,
                    "navigation://download",
                    DownloadPayload {
                        id,
                        url: url.to_string(),
                        name,
                        status: "started".to_string(),
                        path: None,
                    },
                );
                *destination = path;
                true
            }
            DownloadEvent::Finished { url, path, success } => {
                let id = app_for_download
                    .try_state::<NavigationState>()
                    .and_then(|state| {
                        state
                            .downloads
                            .lock()
                            .ok()
                            .and_then(|mut downloads| downloads.remove(&url.to_string()))
                    })
                    .unwrap_or_else(|| Uuid::new_v4().to_string());
                let name = path
                    .as_ref()
                    .and_then(|item| item.file_name())
                    .and_then(|item| item.to_str())
                    .unwrap_or("download")
                    .to_string();
                emit_shell(
                    &app_for_download,
                    &shell_finished,
                    "navigation://download",
                    DownloadPayload {
                        id,
                        url: url.to_string(),
                        name,
                        status: if success { "done" } else { "failed" }.to_string(),
                        path: path.map(|item| item.display().to_string()),
                    },
                );
                true
            }
            _ => true,
        });

    #[cfg(windows)]
    {
        builder = builder
            .browser_extensions_enabled(true)
            .extensions_path(extensions);
    }
    #[cfg(not(windows))]
    {
        let _ = extensions;
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|err| err.to_string())?;
    watch_load(&webview, app.clone(), shell);
    let _ = webview.hide();
    let ok = state
        .lives
        .lock()
        .map_err(|err| err.to_string())?
        .get(&label)
        .copied()
        .flatten();

    let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
    pages.insert(label, webview);
    Ok(OpenResult { ok })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentBody {
    /// 要展示的页面。`None` 表示把内容槽交还给壳层（磁贴）。
    id: Option<String>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// 内容槽同一时刻只交给一方：某个网页，或者壳层自己。
///
/// 「摆位 → 显示目标 → 收起其余」在一次调用里完成，渲染进程无法在中间插入别的动作，
/// 所以不会出现「壳层已经切走、网页还盖着」这类中间态。
#[tauri::command(rename = "navigation:present")]
pub async fn navigation_present(
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: PresentBody,
) -> Result<(), String> {
    let shell = window.label();
    let Some(id) = body.id else {
        hide_pages(&state, shell, None)?;
        return set_surface(&state, shell, None);
    };
    let target = page_label(&id);
    let webview = find_page(&state, shell, &id)?;
    // 隐藏状态下先摆好位置再显示：反过来的话，新页会先在旧位置／1×1 上闪一帧。
    place(&webview, body.x, body.y, body.width, body.height)?;
    hide_pages(&state, shell, Some(&target))?;
    webview.show().map_err(|err| err.to_string())?;
    set_surface(&state, shell, Some(target))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteBody {
    qry: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteItem {
    #[serde(default)]
    id: String,
    #[serde(default)]
    q: String,
    #[serde(default)]
    u: String,
    #[serde(default)]
    t: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteResult {
    s: Vec<CompleteItem>,
}

#[derive(Debug, Deserialize)]
struct BingSuggestion {
    #[serde(default)]
    s: Vec<CompleteItem>,
}

/// 打开浏览窗口。已有窗口就聚焦并把它要打开的地址发过去，没有才新建。
#[tauri::command(rename = "browser:open")]
pub async fn browser_open(
    app: AppHandle,
    state: State<'_, NavigationState>,
    url: Option<String>,
) -> Result<(), String> {
    if let Some(window) = find_browser(&app) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(url) = url {
            emit_shell(
                &app,
                window.label(),
                "navigation://open-url",
                OpenUrlPayload { url },
            );
        }
        return Ok(());
    }
    create_browser(&app, &state, url)
}

/// 新开一扇浏览窗口（不抢已有窗口）。
#[tauri::command(rename = "browser:spawn")]
pub async fn browser_spawn(
    app: AppHandle,
    state: State<'_, NavigationState>,
    url: Option<String>,
) -> Result<(), String> {
    create_browser(&app, &state, url)
}

fn create_browser(
    app: &AppHandle,
    state: &State<'_, NavigationState>,
    url: Option<String>,
) -> Result<(), String> {
    // 编号是「先查后建」，并发建窗会选中同一个：串行化到建窗返回为止。
    let _launch = state.launch.lock().map_err(|err| err.to_string())?;
    let label = free_browser(&app);
    // 编号会被回收复用：先把同名残留清掉，否则会拿到已销毁窗口的句柄。
    prune_space(state, &label);
    if let Some(url) = url {
        state
            .pendings
            .lock()
            .map_err(|err| err.to_string())?
            .insert(label.clone(), url);
    }
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(POPUP_PAGE.into()))
        .title("浏览")
        .decorations(false)
        .transparent(true)
        .inner_size(1200.0, 800.0)
        .min_inner_size(720.0, 520.0)
        // 先不显示：透明窗口在材质（mica）套上之前会透出桌面。等前端绘制完
        // 调 `browser:ready` 再显示。
        .visible(false)
        .build()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

/// 浏览窗口的前端已渲染完成，可以显示了。
#[tauri::command(rename = "browser:ready")]
pub async fn browser_ready(window: tauri::Window) -> Result<(), String> {
    window.show().map_err(|err| err.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

/// 浏览窗口刚建好时前端还没就绪，事件会丢；这里把待打开的地址交给它。
#[tauri::command(rename = "browser:take-pending")]
pub async fn browser_take_pending(
    window: tauri::Window,
    state: State<'_, NavigationState>,
) -> Result<Option<String>, String> {
    Ok(state
        .pendings
        .lock()
        .map_err(|err| err.to_string())?
        .remove(window.label()))
}

/// 搜索建议。不走未注册的 corex `engine.suggestion`。
#[tauri::command(rename = "navigation:complete")]
pub async fn navigation_complete(body: CompleteBody) -> Result<CompleteResult, String> {
    let qry = body.qry.trim().to_string();
    if qry.is_empty() {
        return Ok(CompleteResult { s: Vec::new() });
    }
    let cursor = qry.chars().count().to_string();
    let cvid = Uuid::new_v4().simple().to_string();
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        .build()
        .map_err(|err| err.to_string())?;
    let text = client
        .get("https://cn.bing.com/AS/Suggestions")
        .query(&[
            ("pt", "page.home"),
            ("qry", qry.as_str()),
            ("cp", cursor.as_str()),
            ("csr", "1"),
            ("pths", "1"),
            ("cvid", cvid.as_str()),
        ])
        .send()
        .await
        .map_err(|err| err.to_string())?
        .text()
        .await
        .map_err(|err| err.to_string())?;
    let parsed: BingSuggestion = serde_json::from_str(&text).unwrap_or(BingSuggestion { s: Vec::new() });
    let s = parsed
        .s
        .into_iter()
        .filter(|item| !item.q.trim().is_empty())
        .take(8)
        .collect();
    Ok(CompleteResult { s })
}

/// 只改矩形，不动可见性与层级。窗口拖动/缩放时按帧调用。
#[tauri::command(rename = "navigation:place")]
pub async fn navigation_place(
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: BoundsBody,
) -> Result<(), String> {
    let webview = find_page(&state, window.label(), &body.id)?;
    place(&webview, body.x, body.y, body.width, body.height)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupBody {
    open: bool,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    width: f64,
    #[serde(default)]
    height: f64,
}

/// 地址建议浮层：主窗口的 **owned 顶层窗口**。
///
/// Windows 保证 owned 窗口永远在 owner 之上（并且随 owner 最小化/销毁），所以：
/// - 新开的页面、切标签、内容槽怎么变，都不可能把它盖住；
/// - 应用里不再存在任何 z 序调整。
///
/// 它同时带 `WS_EX_NOACTIVATE`：出现和点击都不夺焦，键盘输入始终留在壳层的地址栏里。
#[tauri::command(rename = "navigation:popup")]
pub async fn navigation_popup(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: PopupBody,
) -> Result<(), String> {
    require_browser(&window)?;
    let shell = window.label().to_string();
    if !body.open {
        let popup = state
            .popups
            .lock()
            .map_err(|err| err.to_string())?
            .get(&shell)
            .cloned();
        if let Some(popup) = popup {
            let _ = popup.hide();
        }
        return Ok(());
    }
    if body.width <= 0.0 || body.height <= 0.0 {
        return Ok(());
    }
    let popup = find_popup(&app, &window, &state, &shell)?;
    // 子视图用客户区坐标；owned 窗口用屏幕物理坐标，所以要加上 owner 客户区原点。
    let scale = window.scale_factor().map_err(|err| err.to_string())?;
    let origin = window.inner_position().map_err(|err| err.to_string())?;
    let width = (body.width * scale).round().max(1.0);
    let height = (body.height * scale).round().max(1.0);
    let left = origin.x + (body.x * scale).round() as i32;
    let top = origin.y + (body.y * scale).round() as i32;
    popup
        .set_size(PhysicalSize::new(width, height))
        .map_err(|err| err.to_string())?;
    popup
        .set_position(PhysicalPosition::new(left, top))
        .map_err(|err| err.to_string())?;
    popup.show().map_err(|err| err.to_string())
}

fn find_popup(
    app: &AppHandle,
    window: &tauri::Window,
    state: &State<'_, NavigationState>,
    shell: &str,
) -> Result<WebviewWindow, String> {
    let mut slot = state.popups.lock().map_err(|err| err.to_string())?;
    if let Some(popup) = slot.get(shell) {
        return Ok(popup.clone());
    }
    // 持锁创建：两路命令并发进来时不会建出两个浮层。
    // 浮层 label 里带上宿主 label，多扇浏览窗口各自一个，互不共用。
    let host = serde_json::to_string(shell).unwrap_or_else(|_| "\"\"".to_string());
    let builder = WebviewWindowBuilder::new(
        app,
        format!("{POPUP_PREFIX}{shell}"),
        WebviewUrl::App(POPUP_PAGE.into()),
    )
    .title("suggest")
    // 渲染层用它分流入口；同时把宿主 label 传进去，浮层才知道把选择交回哪扇窗口。
    .initialization_script(&format!(
        "window.__ITH_SUGGEST_POPUP__ = true; window.__ITH_SUGGEST_HOST__ = {host}"
    ))
    .inner_size(1.0, 1.0)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .resizable(false)
    .skip_taskbar(true)
    .focused(false)
    .visible(false);
    // owned 窗口 = 永远在 owner 之上，且不属于全局置顶。
    #[cfg(windows)]
    let builder = builder.owner_raw(window.hwnd().map_err(|err| err.to_string())?);
    let popup = builder.build().map_err(|err| err.to_string())?;
    allow_no_activate(&popup);
    slot.insert(shell.to_string(), popup.clone());
    Ok(popup)
}

/// `WS_EX_NOACTIVATE`：出现/点击都不激活这个窗口，键盘焦点始终留在壳层的地址栏。
#[cfg(windows)]
fn allow_no_activate(popup: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GWL_EXSTYLE, GetWindowLongPtrW, SetWindowLongPtrW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };

    let Ok(hwnd) = popup.hwnd() else {
        return;
    };
    let extra = (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0) as isize;
    unsafe {
        let current = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, current | extra);
    }
}

#[cfg(not(windows))]
fn allow_no_activate(_popup: &WebviewWindow) {}

/// 把内容槽交还壳层（回到磁贴）。页面不销毁。
#[tauri::command(rename = "navigation:suspend")]
pub async fn navigation_suspend(
    window: tauri::Window,
    state: State<'_, NavigationState>,
) -> Result<(), String> {
    let shell = window.label();
    hide_pages(&state, shell, None)?;
    set_surface(&state, shell, None)
}

#[tauri::command(rename = "navigation:close")]
pub async fn navigation_close(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: IdBody,
) -> Result<(), String> {
    let _ = app;
    let shell = window.label();
    let label = page_label(&body.id);
    let webview = {
        let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
        match pages.get(&label) {
            Some(page) if page.window().label() == shell => pages.remove(&label),
            _ => None,
        }
    };
    if let Ok(mut lives) = state.lives.lock() {
        lives.remove(&label);
    }
    if let Ok(mut surfaces) = state.surfaces.lock()
        && surfaces
            .get(shell)
            .and_then(|value| value.as_deref())
            == Some(label.as_str())
    {
        surfaces.insert(shell.to_string(), None);
    }
    if let Some(webview) = webview {
        let _ = webview.close();
    }
    Ok(())
}

#[tauri::command(rename = "navigation:navigate")]
pub async fn navigation_navigate(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: NavigateBody,
) -> Result<(), String> {
    let _ = app;
    let webview = find_page(&state, window.label(), &body.id)?;
    match body.direction.as_deref() {
        Some("back") => webview
            .eval("history.back()")
            .map_err(|err| err.to_string()),
        Some("forward") => webview
            .eval("history.forward()")
            .map_err(|err| err.to_string()),
        Some("reload") => webview.reload().map_err(|err| err.to_string()),
        _ => {
            let raw = body.url.ok_or_else(|| "缺少网址".to_string())?;
            let url = parse_http_url(&raw)?;
            webview.navigate(url).map_err(|err| err.to_string())
        }
    }
}

#[tauri::command(rename = "navigation:devtools")]
pub async fn navigation_devtools(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: IdBody,
) -> Result<(), String> {
    let _ = app;
    let webview = find_page(&state, window.label(), &body.id)?;
    webview.open_devtools();
    Ok(())
}

#[tauri::command(rename = "navigation:extensions")]
pub async fn navigation_extensions(
    app: AppHandle,
    body: ExtensionsBody,
) -> Result<ExtensionsResult, String> {
    let dir = extensions_dir(&app)?;
    match body {
        ExtensionsBody::Read => {}
        ExtensionsBody::Import { path } => {
            let source = PathBuf::from(path);
            if !source.join("manifest.json").is_file() {
                return Err("选择的目录里没有 manifest.json".to_string());
            }
            let name = source
                .file_name()
                .and_then(|item| item.to_str())
                .filter(|name| {
                    !name.is_empty()
                        && !name.contains("..")
                        && !name.contains('/')
                        && !name.contains('\\')
                })
                .ok_or_else(|| "扩展目录名无效".to_string())?;
            let target = dir.join(name);
            if target.exists() {
                return Err("同名扩展已存在".to_string());
            }
            copy_dir(&source, &target)?;
        }
        ExtensionsBody::Remove { name } => {
            if name.contains("..") || name.contains('/') || name.contains('\\') {
                return Err("扩展名无效".to_string());
            }
            let target = dir.join(&name);
            if target.is_dir() {
                std::fs::remove_dir_all(target).map_err(|err| err.to_string())?;
            }
        }
    }
    Ok(ExtensionsResult {
        names: list_extensions(&dir)?,
        supported: cfg!(windows),
    })
}

#[cfg(test)]
mod tests {
    use super::{browser_label, browser_index, finish_ok, is_browser};

    #[test]
    fn finished_http_without_report_is_open() {
        assert!(finish_ok("https://y.qq.com/", None));
    }

    #[test]
    fn reported_failure_stays_closed() {
        assert!(!finish_ok("https://y.qq.com/", Some(false)));
    }

    #[test]
    fn reported_success_is_open() {
        assert!(finish_ok("https://y.qq.com/", Some(true)));
    }

    #[test]
    fn first_browser_window_has_no_number() {
        assert_eq!(browser_label(1), "browser");
        assert_eq!(browser_label(2), "browser-2");
    }

    #[test]
    fn browser_labels_round_trip() {
        for index in 1..5 {
            assert_eq!(browser_index(&browser_label(index)), Some(index));
        }
    }

    #[test]
    fn other_windows_are_not_browsers() {
        assert!(!is_browser("main"));
        assert!(!is_browser("navigation-popup-browser"));
        assert!(!is_browser("browser-x"));
        assert!(is_browser("browser-12"));
    }
}
