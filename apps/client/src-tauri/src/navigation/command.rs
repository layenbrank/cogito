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
#[serde(rename_all = "camelCase")]
struct PagePayload {
    id: String,
    url: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TitlePayload {
    id: String,
    title: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PopupPayload {
    url: String,
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

/// 创建远程子 Webview。Windows 上必须在异步命令里调用，避免和 WebView2 死锁。
#[tauri::command(rename = "navigation:open")]
pub async fn navigation_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, NavigationState>,
    body: OpenBody,
) -> Result<(), String> {
    if !is_safe_id(&body.id) {
        return Err("页面 id 无效".to_string());
    }
    let url = parse_http_url(&body.url)?;
    let label = page_label(&body.id);
    {
        let pages = state.pages.lock().map_err(|err| err.to_string())?;
        if pages.contains_key(&label) {
            return Ok(());
        }
    }

    let shell = window.label().to_string();
    let profile = profile_dir(&app)?;
    let extensions = extensions_dir(&app)?;
    let download_root = download_dir(&app);
    let app_for_download = app.clone();
    let app_for_title = app.clone();
    let app_for_load = app.clone();
    let app_for_popup = app.clone();

    let shell_title = shell.clone();
    let shell_load = shell.clone();
    let shell_popup = shell.clone();
    let shell_download = shell.clone();
    let shell_finished = shell.clone();

    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(url))
        .data_directory(profile)
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
            emit_shell(
                &app_for_load,
                &shell_load,
                "navigation://view",
                PagePayload {
                    id: page_id(webview.label()),
                    url: payload.url().to_string(),
                },
            );
        })
        .on_new_window(move |url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                emit_shell(
                    &app_for_popup,
                    &shell_popup,
                    "navigation://popup",
                    PopupPayload {
                        url: url.to_string(),
                    },
                );
            }
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
    let webview = pages.get(&target).ok_or_else(|| "页面不存在".to_string())?;
    webview.show().map_err(|err| err.to_string())?;
    let placed = place(webview, body.x, body.y, body.width, body.height);
    drop(pages);
    raise_bar(&state);
    placed
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
    {
        let bar = state.bar.lock().map_err(|err| err.to_string())?;
        if bar.is_some() {
            return Ok(());
        }
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

fn window_of(webview: &tauri::Webview) -> tauri::Window {
    webview.window()
}

/// 把刚摆好的子窗口抬到其它子 WebView 上面。候选列表才能盖住网页。
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
    let placed = place(&webview, body.x, body.y, body.width, body.height);
    raise_bar(&state);
    placed
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
