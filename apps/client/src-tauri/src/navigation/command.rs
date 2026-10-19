use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Position, Size, State, Url,
    WebviewUrl,
};
use uuid::Uuid;

use crate::navigation::state::NavigationState;

const PAGE_PREFIX: &str = "page-";
const BAR_LABEL: &str = "navigation-bar";
const BAR_URL: &str = "/navigation/bar";
const MAIN_LABEL: &str = "main";
const OPEN_URL_MARK: &str = "i-thinking:open-url:";

/// 在 WebView2 处理点击之前把新窗口地址交给宿主。`postMessage` 成功后才取消默认动作，避免只吞掉点击。
const OPEN_URL_SCRIPT: &str = r#"(function () {
  var mark = "i-thinking:open-url:"
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
    if (!window.chrome || !window.chrome.webview || !window.chrome.webview.postMessage) return "skip"
    window.chrome.webview.postMessage(mark + parsed.href)
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
  var nativeOpen = window.open
  window.open = function (url) {
    if (typeof url !== "string") return nativeOpen.apply(window, arguments)
    var result = send(url)
    if (result === "sent" || result === "other") return null
    return nativeOpen.apply(window, arguments)
  }
})()"#;

fn require_main(window: &tauri::Window) -> Result<(), String> {
    if window.label() == MAIN_LABEL {
        Ok(())
    } else {
        Err("网址页面只能挂在主窗口".to_string())
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

fn find_page(state: &NavigationState, id: &str) -> Result<tauri::Webview, String> {
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    pages
        .get(&page_label(id))
        .cloned()
        .ok_or_else(|| "页面不存在".to_string())
}

/// 记下这次导航是否成功。切走只隐藏 WebView，关闭才销毁，所以结果要单独报给侧栏。
#[cfg(windows)]
fn watch_load(webview: &tauri::Webview, app: AppHandle, shell: String, id: String) {
    let app_for_external = app.clone();
    let shell_external = shell.clone();
    let app_for_open = app.clone();
    let shell_open = shell.clone();
    let watched = webview.with_webview(move |platform| {
        if let Err(err) = bind_load(&platform, app, shell, id) {
            log::warn!("[navigation] 监听页面加载结果失败: {err}");
        }
        if let Err(err) = bind_external(&platform, app_for_external, shell_external) {
            log::warn!("[navigation] 监听外部协议失败: {err}");
        }
        if let Err(err) = bind_open_url(platform, app_for_open, shell_open) {
            log::warn!("[navigation] 监听页内新窗口失败: {err}");
        }
    });
    if let Err(err) = watched {
        log::warn!("[navigation] 挂接页面加载结果失败: {err}");
    }
}

#[cfg(windows)]
fn bind_load(
    platform: &tauri::webview::PlatformWebview,
    app: AppHandle,
    shell: String,
    id: String,
) -> windows::core::Result<()> {
    use webview2_com::NavigationCompletedEventHandler;
    use windows::core::BOOL;

    let core = unsafe { platform.controller().CoreWebView2() }?;
    let handler = NavigationCompletedEventHandler::create(Box::new(move |_view, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let mut ok = BOOL(0);
        unsafe { args.IsSuccess(&mut ok)? };
        emit_shell(
            &app,
            &shell,
            "navigation://load",
            LoadPayload {
                id: id.clone(),
                ok: ok.as_bool(),
            },
        );
        Ok(())
    }));
    let mut token = 0_i64;
    unsafe { core.add_NavigationCompleted(&handler, &mut token) }
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

/// 页面脚本在取消点击之前送来的 http/https。这里再发给侧栏开「网址」标签。
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
fn watch_load(webview: &tauri::Webview, app: AppHandle, shell: String, id: String) {
    let _ = (webview, app, shell, id);
}

/// 创建远程子 Webview。Windows 上必须在异步命令里调用，避免和 WebView2 死锁。
#[tauri::command(rename = "navigation:open")]
pub async fn navigation_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: OpenBody,
) -> Result<(), String> {
    require_main(&window)?;
    if !is_safe_id(&body.id) {
        return Err("页面 id 无效".to_string());
    }
    let url = parse_http_url(&body.url)?;
    let label = page_label(&body.id);
    let stale = {
        let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
        match pages.get(&label) {
            Some(existing) if existing.window().label() == window.label() => return Ok(()),
            Some(_) => pages.remove(&label),
            None => None,
        }
    };
    if let Some(stale) = stale {
        let _ = stale.close();
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

    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(profile)
        .initialization_script_for_all_frames(OPEN_URL_SCRIPT)
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
            emit_shell(
                &app_for_load,
                &shell_load,
                "navigation://view",
                PagePayload {
                    id: id.clone(),
                    url,
                },
            );
            // Windows 的 Finished 在失败时也会到，成功与否改由 NavigationCompleted.IsSuccess 发出。
            #[cfg(windows)]
            let _ = id;
            #[cfg(not(windows))]
            emit_shell(
                &app_for_load,
                &shell_load,
                "navigation://load",
                LoadPayload {
                    id,
                    ok: matches!(payload.url().scheme(), "http" | "https"),
                },
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
    watch_load(&webview, app.clone(), shell, body.id.clone());
    let _ = webview.hide();

    let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
    pages.insert(label, webview);
    Ok(())
}

#[tauri::command(rename = "navigation:activate")]
pub async fn navigation_activate(
    app: AppHandle,
    state: State<'_, NavigationState>,
    body: BoundsBody,
) -> Result<(), String> {
    let _ = app;
    let target = page_label(&body.id);
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    for (label, webview) in pages.iter() {
        if label == &target {
            continue;
        }
        let _ = webview.hide();
    }
    let webview = pages
        .get(&target)
        .cloned()
        .ok_or_else(|| "页面不存在".to_string())?;
    webview.show().map_err(|err| err.to_string())?;
    place(&webview, body.x, body.y, body.width, body.height)?;
    drop(pages);
    raise_bar(&state);
    note_page(&webview, body.x, body.y, body.width, body.height);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    /// 工具栏条的高度。加高后的透明区域从这里往下。
    #[serde(default)]
    toolbar: f64,
    #[serde(default)]
    list_x: f64,
    #[serde(default)]
    list_y: f64,
    #[serde(default)]
    list_width: f64,
    #[serde(default)]
    list_height: f64,
}

/// 嵌入地址栏。子 WebView 是 `WS_CHILD`，随网址窗口移动，不使用顶层窗口的 shadow / parent。
#[tauri::command(rename = "navigation:bar-open")]
pub async fn navigation_bar_open(
    window: tauri::Window,
    state: State<'_, NavigationState>,
) -> Result<(), String> {
    require_main(&window)?;
    let stale = {
        let mut bar = state.bar.lock().map_err(|err| err.to_string())?;
        match bar.as_ref() {
            Some(existing) if existing.window().label() == window.label() => return Ok(()),
            Some(_) => bar.take(),
            None => None,
        }
    };
    if let Some(stale) = stale {
        let _ = stale.close();
    }

    let builder = WebviewBuilder::new(BAR_LABEL, WebviewUrl::App(BAR_URL.into()))
        .focused(false)
        .transparent(true);
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(0.0, 0.0),
            LogicalSize::new(1.0, 1.0),
        )
        .map_err(|err| err.to_string())?;
    let _ = webview.hide();

    let mut bar = state.bar.lock().map_err(|err| err.to_string())?;
    if bar.is_some() {
        let _ = webview.close();
        return Ok(());
    }
    *bar = Some(webview);
    Ok(())
}

/// 按占位矩形摆放地址栏。高度为 0 时不显示。
#[tauri::command(rename = "navigation:bar-place")]
pub async fn navigation_bar_place(
    state: State<'_, NavigationState>,
    body: BarBounds,
) -> Result<(), String> {
    if body.width <= 0.0 || body.height <= 0.0 {
        return Ok(());
    }
    {
        let mut at = state.bar_at.lock().map_err(|err| err.to_string())?;
        *at = Some((body.x, body.y));
    }
    let bar = state.bar.lock().map_err(|err| err.to_string())?;
    let webview = bar.as_ref().ok_or_else(|| "地址栏不存在".to_string())?;
    place(webview, body.x, body.y, body.width, body.height)?;
    webview.show().map_err(|err| err.to_string())?;
    let window = window_of(webview);
    remember_hit(&window, &body);
    raise_child(&window, body.x, body.y);
    Ok(())
}

/// 关掉地址栏子 WebView。地址栏改由主窗口自己绘制。
#[tauri::command(rename = "navigation:bar-close")]
pub async fn navigation_bar_close(state: State<'_, NavigationState>) -> Result<(), String> {
    let webview = {
        let mut bar = state.bar.lock().map_err(|err| err.to_string())?;
        bar.take()
    };
    if let Ok(mut at) = state.bar_at.lock() {
        *at = None;
    }
    if let Some(webview) = webview {
        let _ = webview.close();
    }
    Ok(())
}

fn window_of(webview: &tauri::Webview) -> tauri::Window {
    webview.window()
}

/// 记住刚摆好的网页窗口，切标签时用来避开已经隐藏的那一页。
#[cfg(windows)]
fn cache_page_hwnd(hwnd: windows::Win32::Foundation::HWND) {
    if hwnd.is_invalid() {
        return;
    }
    if let Ok(mut slot) = PAGE_HWND.lock() {
        *slot = Some(hwnd.0 as isize);
    }
}

fn cached_page_hwnd() -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsWindowVisible};

    let raw = PAGE_HWND.lock().ok().and_then(|slot| *slot)?;
    let hwnd = HWND(raw as *mut std::ffi::c_void);
    if hwnd.is_invalid() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return None;
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return None;
    }
    Some(hwnd)
}

fn find_child_hwnd(
    window: &tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{
        GW_CHILD, GW_HWNDNEXT, GetWindow, GetWindowRect, IsWindowVisible,
    };

    let parent = window.hwnd().ok()?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let expect_left = (x * scale).round() as i32;
    let expect_top = (y * scale).round() as i32;
    let expect_width = (width * scale).round() as i32;
    let expect_height = (height * scale).round() as i32;
    let mut origin = POINT { x: 0, y: 0 };
    if !unsafe { ClientToScreen(parent, &mut origin) }.as_bool() {
        return None;
    }
    let previous = cached_page_hwnd();
    let mut child = unsafe { GetWindow(parent, GW_CHILD) }.ok();
    let mut matched = HWND::default();
    let mut best = i32::MAX;
    while let Some(hwnd) = child {
        let next = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
        let mut rect = RECT::default();
        let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
        if visible && unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
            let dw = (rect.right - rect.left - expect_width).abs();
            let dh = (rect.bottom - rect.top - expect_height).abs();
            if dw <= 48 && dh <= 48 {
                let mut score = (rect.left - origin.x - expect_left).abs()
                    + (rect.top - origin.y - expect_top).abs();
                // 刚切走的标签还停在同一矩形上时，优先当前可见的另一页。
                if previous == Some(hwnd) {
                    score += 1;
                }
                if score < best {
                    best = score;
                    matched = hwnd;
                }
            }
        }
        child = next;
    }
    if best > 49 || matched.is_invalid() {
        None
    } else {
        cache_page_hwnd(matched);
        Some(matched)
    }
}

fn raise_child(window: &tauri::Window, x: f64, y: f64) {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{HWND, POINT, RECT};
        use windows::Win32::Graphics::Gdi::ClientToScreen;
        use windows::Win32::UI::WindowsAndMessaging::{
            GW_CHILD, GW_HWNDNEXT, GetWindow, GetWindowRect, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE,
            SWP_NOSIZE, SetWindowPos,
        };

        let Ok(parent) = window.hwnd() else {
            return;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let expect_left = (x * scale).round() as i32;
        let expect_top = (y * scale).round() as i32;
        let mut origin = POINT { x: 0, y: 0 };
        if !unsafe { ClientToScreen(parent, &mut origin) }.as_bool() {
            return;
        }
        let mut child = unsafe { GetWindow(parent, GW_CHILD) }.ok();
        let mut matched = HWND::default();
        let mut best = i32::MAX;
        while let Some(hwnd) = child {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let score = (rect.left - origin.x - expect_left).abs()
                    + (rect.top - origin.y - expect_top).abs();
                if score < best {
                    best = score;
                    matched = hwnd;
                }
            }
            child = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
        }
        if best > 12 || matched.is_invalid() {
            return;
        }
        let _ = unsafe {
            SetWindowPos(
                matched,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
        };
        subclass_bar(matched);
    }
    #[cfg(not(windows))]
    {
        let _ = (window, x, y);
    }
}

struct HitBox {
    toolbar: f64,
    list_x: f64,
    list_y: f64,
    list_width: f64,
    list_height: f64,
    scale: f64,
}

fn remember_hit(window: &tauri::Window, body: &BarBounds) {
    let toolbar = if body.toolbar > 0.0 {
        body.toolbar
    } else {
        body.height
    };
    let mut hit = BAR_HIT.lock().unwrap_or_else(|err| err.into_inner());
    *hit = HitBox {
        toolbar,
        list_x: body.list_x,
        list_y: body.list_y,
        list_width: body.list_width,
        list_height: body.list_height,
        scale: window.scale_factor().unwrap_or(1.0),
    };
}

static BAR_HIT: Mutex<HitBox> = Mutex::new(HitBox {
    toolbar: 0.0,
    list_x: 0.0,
    list_y: 0.0,
    list_width: 0.0,
    list_height: 0.0,
    scale: 1.0,
});

#[cfg(windows)]
static BAR_PROCS: LazyLock<
    Mutex<
        HashMap<
            isize,
            unsafe extern "system" fn(
                windows::Win32::Foundation::HWND,
                u32,
                windows::Win32::Foundation::WPARAM,
                windows::Win32::Foundation::LPARAM,
            ) -> windows::Win32::Foundation::LRESULT,
        >,
    >,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

#[cfg(windows)]
fn subclass_bar(hwnd: windows::Win32::Foundation::HWND) {
    use windows::Win32::Foundation::{LPARAM, TRUE};
    use windows::Win32::UI::WindowsAndMessaging::{EnumChildWindows, GWLP_WNDPROC, SetWindowLongPtrW};

    fn hook(hwnd: windows::Win32::Foundation::HWND) {
        let key = hwnd.0 as isize;
        let mut procs = BAR_PROCS.lock().unwrap_or_else(|err| err.into_inner());
        if procs.contains_key(&key) {
            return;
        }
        let prev = unsafe {
            SetWindowLongPtrW(hwnd, GWLP_WNDPROC, bar_hit_proc as *const () as usize as isize)
        };
        if prev == 0 {
            return;
        }
        procs.insert(key, unsafe { std::mem::transmute(prev) });
    }

    unsafe extern "system" fn each(hwnd: windows::Win32::Foundation::HWND, _param: LPARAM) -> windows::core::BOOL {
        hook(hwnd);
        TRUE
    }

    hook(hwnd);
    let _ = unsafe { EnumChildWindows(Some(hwnd), Some(each), LPARAM(0)) };
}

#[cfg(windows)]
unsafe extern "system" fn bar_hit_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use windows::Win32::Foundation::{LRESULT, POINT};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::WindowsAndMessaging::{CallWindowProcW, DefWindowProcW, HTTRANSPARENT, WM_NCHITTEST};

    if msg == WM_NCHITTEST {
        let mut point = POINT {
            x: lparam.0 as i16 as i32,
            y: (lparam.0 >> 16) as i16 as i32,
        };
        if unsafe { ScreenToClient(hwnd, &mut point) }.as_bool() && !hit_allows(point.x, point.y) {
            return LRESULT(HTTRANSPARENT as isize);
        }
    }
    let prev = BAR_PROCS
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .get(&(hwnd.0 as isize))
        .copied();
    if let Some(prev) = prev {
        return unsafe { CallWindowProcW(Some(prev), hwnd, msg, wparam, lparam) };
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

fn hit_allows(x: i32, y: i32) -> bool {
    let hit = BAR_HIT.lock().unwrap_or_else(|err| err.into_inner());
    if hit.list_height <= 0.0 {
        return true;
    }
    let scale = if hit.scale > 0.0 { hit.scale } else { 1.0 };
    let css_x = f64::from(x) / scale;
    let css_y = f64::from(y) / scale;
    if css_y <= hit.toolbar {
        return true;
    }
    css_x >= hit.list_x
        && css_x < hit.list_x + hit.list_width
        && css_y >= hit.list_y
        && css_y < hit.list_y + hit.list_height
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

#[tauri::command(rename = "navigation:place")]
pub async fn navigation_place(
    app: AppHandle,
    state: State<'_, NavigationState>,
    body: BoundsBody,
) -> Result<(), String> {
    let _ = app;
    let webview = find_page(&state, &body.id)?;
    place(&webview, body.x, body.y, body.width, body.height)?;
    raise_bar(&state);
    note_page(&webview, body.x, body.y, body.width, body.height);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackBody {
    /// 网页是否盖在壳层上面。弹层打开时为 false。
    above: bool,
}

static PAGE_AT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);
static PAGE_BELOW: Mutex<bool> = Mutex::new(false);
static PAGE_HWND: Mutex<Option<isize>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPoint {
    x: f64,
    y: f64,
}

/// 光标相对主窗口客户区的位置。只认 `main`，不碰 overlay 的鼠标穿透。
#[tauri::command(rename = "navigation:cursor")]
pub async fn navigation_cursor(window: tauri::Window) -> Result<Option<CursorPoint>, String> {
    if window.label() != MAIN_LABEL {
        return Ok(None);
    }
    let Some((px, py)) = crate::through::cursor::get_cursor_position() else {
        return Ok(None);
    };
    let scale = window.scale_factor().unwrap_or(1.0);
    let origin = window
        .inner_position()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(scale);
    let size = window
        .inner_size()
        .map_err(|err| err.to_string())?
        .to_logical::<f64>(scale);
    let x = px as f64 / scale - origin.x;
    let y = py as f64 / scale - origin.y;
    if x < 0.0 || y < 0.0 || x >= size.width || y >= size.height {
        return Ok(None);
    }
    Ok(Some(CursorPoint { x, y }))
}

/// 弹层打开时把网页压到壳层下面，关掉再抬回来。不改窗口大小，也不挖空。
#[tauri::command(rename = "navigation:stack")]
pub async fn navigation_stack(window: tauri::Window, body: StackBody) -> Result<(), String> {
    if let Ok(mut below) = PAGE_BELOW.lock() {
        *below = !body.above;
    }
    stack_page(&window);
    Ok(())
}

fn note_page(webview: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) {
    if let Ok(mut at) = PAGE_AT.lock() {
        *at = Some((x, y, width, height));
    }
    stack_page(&webview.window());
}

fn stack_page(window: &tauri::Window) {
    #[cfg(windows)]
    {
        use windows::Win32::UI::WindowsAndMessaging::{
            HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SetWindowPos,
        };

        let Some((x, y, width, height)) = PAGE_AT.lock().ok().and_then(|slot| *slot) else {
            return;
        };
        let below = PAGE_BELOW.lock().map(|slot| *slot).unwrap_or(false);
        let hwnd = find_child_hwnd(window, x, y, width, height).or_else(|| {
            visible_page_hwnd(window)
        });
        let Some(hwnd) = hwnd else {
            return;
        };
        cache_page_hwnd(hwnd);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                Some(if below { HWND_BOTTOM } else { HWND_TOP }),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
    }
}

/// 矩形还没跟上时，用「唯一可见、且不是铺满主窗口的子窗口」当作当前网页。
#[cfg(windows)]
fn visible_page_hwnd(window: &tauri::Window) -> Option<windows::Win32::Foundation::HWND> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GW_CHILD, GW_HWNDNEXT, GetWindow, GetWindowRect, IsWindowVisible,
    };

    let parent = window.hwnd().ok()?;
    let shell = window.inner_size().ok()?;
    let mut child = unsafe { GetWindow(parent, GW_CHILD) }.ok();
    let mut found = HWND::default();
    let mut count = 0i32;
    while let Some(hwnd) = child {
        let next = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }.ok();
        if unsafe { IsWindowVisible(hwnd) }.as_bool() {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
                let width = (rect.right - rect.left).unsigned_abs();
                let height = (rect.bottom - rect.top).unsigned_abs();
                let is_shell = width.abs_diff(shell.width) <= 8 && height.abs_diff(shell.height) <= 8;
                if !is_shell {
                    count += 1;
                    found = hwnd;
                }
            }
        }
        child = next;
    }
    if count == 1 && !found.is_invalid() {
        Some(found)
    } else {
        None
    }
}

fn raise_bar(state: &NavigationState) {
    let Some((x, y)) = state.bar_at.lock().ok().and_then(|at| *at) else {
        return;
    };
    let Ok(bar) = state.bar.lock() else {
        return;
    };
    let Some(webview) = bar.as_ref() else {
        return;
    };
    raise_child(&window_of(webview), x, y);
}

/// 隐藏全部页面子 WebView。地址栏保持显示，页面不销毁。
#[tauri::command(rename = "navigation:suspend")]
pub async fn navigation_suspend(state: State<'_, NavigationState>) -> Result<(), String> {
    let pages = state.pages.lock().map_err(|err| err.to_string())?;
    for webview in pages.values() {
        let _ = webview.hide();
    }
    Ok(())
}

#[tauri::command(rename = "navigation:close")]
pub async fn navigation_close(
    app: AppHandle,
    state: State<'_, NavigationState>,
    body: IdBody,
) -> Result<(), String> {
    let _ = app;
    let label = page_label(&body.id);
    let webview = {
        let mut pages = state.pages.lock().map_err(|err| err.to_string())?;
        pages.remove(&label)
    };
    if let Some(webview) = webview {
        let _ = webview.close();
    }
    Ok(())
}

#[tauri::command(rename = "navigation:navigate")]
pub async fn navigation_navigate(
    app: AppHandle,
    state: State<'_, NavigationState>,
    body: NavigateBody,
) -> Result<(), String> {
    let _ = app;
    let webview = find_page(&state, &body.id)?;
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
    state: State<'_, NavigationState>,
    body: IdBody,
) -> Result<(), String> {
    let _ = app;
    let webview = find_page(&state, &body.id)?;
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
