//! 枚举可见顶层窗口、客户区与子控件，换算为 overlay 局部逻辑像素。
//! 不 hide overlay；忽略自身 HWND。
//! 过滤与矩形取法对照 ShareX WindowsRectangleList / CaptureHelpers（GPL，仅算法，不拷贝源码）。

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};

use crate::capture::schema::{CaptureRegion, RegionKind};
use crate::overlay::command::OVERLAY_LABEL;

const MIN_SIDE_PX: i32 = 8;

/// NVIDIA overlay + 桌面宿主（Progman/WorkerW）+ 无意义 Button
const IGNORE_CLASSES: &[&str] = &["CEF-OSC-WIDGET", "Progman", "WorkerW", "Button"];

/// 子控件候选总量上限：浏览器 / IDE 的控件树很大，撑爆候选列表反而没法用
const MAX_CHILD_REGIONS: usize = 400;

/// 物理屏幕像素矩形（虚拟桌面坐标系）
#[derive(Debug, Clone, Copy)]
pub struct ScreenBox {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// 候选矩形的元信息（窗口/元素身份）
#[derive(Debug, Clone, Default)]
pub struct RegionMeta {
    pub kind: RegionKind,
    pub hwnd: String,
    pub title: String,
    pub z: u32,
    pub control_type: String,
}

/// overlay 的物理屏幕框：负责把物理像素矩形换算成 overlay 局部逻辑像素
pub struct OverlayFrame {
    origin: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    scale: f64,
    /// 浮层自身窗口句柄：枚举候选时要忽略自己
    pub hwnd: Option<isize>,
}

impl OverlayFrame {
    pub fn find(app: &AppHandle) -> Option<Self> {
        let window = app.get_webview_window(OVERLAY_LABEL)?;
        let monitor = app.primary_monitor().ok()??;
        let scale = window.scale_factor().unwrap_or(1.0).max(0.01);
        Some(Self {
            origin: *monitor.position(),
            size: *monitor.size(),
            scale,
            hwnd: window.hwnd().ok().map(|hwnd| hwnd.0 as isize),
        })
    }

    /// 浮层自身句柄（十六进制），与 `CaptureRegion.hwnd` 同一格式
    pub fn hwnd_text(&self) -> Option<String> {
        self.hwnd
            .filter(|hwnd| *hwnd != 0)
            .map(|hwnd| format!("{hwnd:x}"))
    }

    /// 物理屏幕坐标 → overlay 局部逻辑坐标
    pub fn to_logical(&self, x: i32, y: i32) -> (f64, f64) {
        (
            f64::from(x - self.origin.x) / self.scale,
            f64::from(y - self.origin.y) / self.scale,
        )
    }

    /// 逻辑坐标 → 物理屏幕坐标（UIA / 光标查询用）
    pub fn to_physical(&self, x: f64, y: f64) -> (i32, i32) {
        (
            self.origin.x + (x * self.scale).round() as i32,
            self.origin.y + (y * self.scale).round() as i32,
        )
    }

    /// 裁剪到 overlay 范围内并换算为逻辑像素；越界或过小返回 None
    pub fn to_region(&self, screen: ScreenBox, meta: &RegionMeta) -> Option<CaptureRegion> {
        let mx = self.origin.x;
        let my = self.origin.y;
        let right = mx.saturating_add(self.size.width as i32);
        let bottom = my.saturating_add(self.size.height as i32);
        let left = screen.left.max(mx);
        let top = screen.top.max(my);
        let clip_right = screen.right.min(right);
        let clip_bottom = screen.bottom.min(bottom);
        let pw = clip_right - left;
        let ph = clip_bottom - top;
        if pw < MIN_SIDE_PX || ph < MIN_SIDE_PX {
            return None;
        }
        Some(CaptureRegion {
            x: f64::from(left - mx) / self.scale,
            y: f64::from(top - my) / self.scale,
            w: f64::from(pw) / self.scale,
            h: f64::from(ph) / self.scale,
            kind: meta.kind,
            hwnd: meta.hwnd.clone(),
            title: meta.title.clone(),
            z: meta.z,
            control_type: meta.control_type.clone(),
        })
    }
}

pub fn find_overlay_regions(app: &AppHandle) -> Vec<CaptureRegion> {
    let Some(frame) = OverlayFrame::find(app) else {
        return Vec::new();
    };

    #[cfg(windows)]
    {
        let ignore = frame
            .hwnd
            .filter(|hwnd| *hwnd != 0)
            .map(|hwnd| windows::Win32::Foundation::HWND(hwnd as *mut core::ffi::c_void));
        find_windows_regions(ignore, &frame)
    }
    #[cfg(not(windows))]
    {
        let _ = frame;
        Vec::new()
    }
}

#[cfg(windows)]
fn find_windows_regions(
    ignore: Option<windows::Win32::Foundation::HWND>,
    frame: &OverlayFrame,
) -> Vec<CaptureRegion> {
    use windows::Win32::Foundation::{FALSE, HWND, LPARAM, POINT, RECT, TRUE};
    use windows::Win32::Graphics::Dwm::{
        DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute,
    };
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumChildWindows, EnumWindows, GWL_EXSTYLE, GetClassNameW, GetClientRect, GetWindowLongW,
        GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    };
    use windows::core::BOOL;

    struct EnumState<'a> {
        ignore: Option<HWND>,
        frame: &'a OverlayFrame,
        /// 顶层窗口枚举序号即 z 序（0 = 最上层）
        z: u32,
        child_budget: usize,
        regions: Vec<CaptureRegion>,
    }

    struct ChildState<'a> {
        frame: &'a OverlayFrame,
        hwnd: String,
        title: String,
        z: u32,
        remaining: &'a mut usize,
        regions: &'a mut Vec<CaptureRegion>,
    }

    /// 子控件：给选择器提供「比窗口更细」的候选（对照 ShareX 的 DetectControls）
    unsafe extern "system" fn enum_child_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = unsafe { &mut *(lparam.0 as *mut ChildState) };
        if *state.remaining == 0 {
            return FALSE;
        }
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return TRUE;
        }
        let class_name = window_class(hwnd);
        if IGNORE_CLASSES
            .iter()
            .any(|name| class_name.eq_ignore_ascii_case(name))
        {
            return TRUE;
        }
        let Some(child_box) = window_frame(hwnd) else {
            return TRUE;
        };
        let meta = RegionMeta {
            kind: RegionKind::Child,
            hwnd: state.hwnd.clone(),
            title: state.title.clone(),
            z: state.z,
            control_type: class_name,
        };
        if let Some(region) = state.frame.to_region(to_screen_box(child_box), &meta) {
            *state.remaining -= 1;
            state.regions.push(region);
        }
        TRUE
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = unsafe { &mut *(lparam.0 as *mut EnumState) };
        if state.ignore == Some(hwnd) {
            return TRUE;
        }
        if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            return TRUE;
        }
        if unsafe { IsIconic(hwnd) }.as_bool() {
            return TRUE;
        }
        if is_cloaked(hwnd) {
            return TRUE;
        }

        let class_name = window_class(hwnd);
        if IGNORE_CLASSES
            .iter()
            .any(|name| class_name.eq_ignore_ascii_case(name))
        {
            return TRUE;
        }

        let ex_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        let is_tool = ex_style & WS_EX_TOOLWINDOW.0 != 0;
        let is_noactivate = ex_style & WS_EX_NOACTIVATE.0 != 0;
        if is_tool && is_noactivate {
            return TRUE;
        }

        let Some(window_box) = window_frame(hwnd) else {
            return TRUE;
        };
        let hwnd_text = hwnd_id(hwnd);
        let title = window_title(hwnd);
        let z = state.z;
        state.z += 1;

        // 客户区先入列：同窗内悬停优先内容区（对照 ShareX 先 Add client 再 Add window）
        if let Some(client) = client_frame(hwnd) {
            if !same_rect(&client, &window_box) {
                let meta = RegionMeta {
                    kind: RegionKind::Client,
                    hwnd: hwnd_text.clone(),
                    title: title.clone(),
                    z,
                    control_type: String::new(),
                };
                if let Some(region) = state.frame.to_region(to_screen_box(client), &meta) {
                    state.regions.push(region);
                }
            }
        }
        let window_meta = RegionMeta {
            kind: RegionKind::Frame,
            hwnd: hwnd_text.clone(),
            title: title.clone(),
            z,
            control_type: String::new(),
        };
        if let Some(region) = state
            .frame
            .to_region(to_screen_box(window_box), &window_meta)
        {
            state.regions.push(region);
        }

        if state.child_budget > 0 {
            let mut child_state = ChildState {
                frame: state.frame,
                hwnd: hwnd_text,
                title,
                z,
                remaining: &mut state.child_budget,
                regions: &mut state.regions,
            };
            let _ = unsafe {
                EnumChildWindows(
                    Some(hwnd),
                    Some(enum_child_proc),
                    LPARAM(&mut child_state as *mut ChildState as isize),
                )
            };
        }
        TRUE
    }

    fn is_cloaked(hwnd: HWND) -> bool {
        let mut cloaked: u32 = 0;
        let ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
        };
        ok.is_ok() && cloaked != 0
    }

    fn window_class(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        if len <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len as usize])
    }

    fn window_frame(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        let extended = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut rect as *mut RECT as *mut _,
                std::mem::size_of::<RECT>() as u32,
            )
        };
        if extended.is_ok() {
            return Some(rect);
        }
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        Some(rect)
    }

    fn client_frame(hwnd: HWND) -> Option<RECT> {
        let mut rect = RECT::default();
        unsafe { GetClientRect(hwnd, &mut rect) }.ok()?;
        let mut origin = POINT {
            x: rect.left,
            y: rect.top,
        };
        if !unsafe { ClientToScreen(hwnd, &mut origin) }.as_bool() {
            return None;
        }
        Some(RECT {
            left: origin.x,
            top: origin.y,
            right: origin.x + (rect.right - rect.left),
            bottom: origin.y + (rect.bottom - rect.top),
        })
    }

    fn same_rect(a: &RECT, b: &RECT) -> bool {
        a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom
    }

    fn to_screen_box(rect: RECT) -> ScreenBox {
        ScreenBox {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        }
    }

    fn hwnd_id(hwnd: HWND) -> String {
        format!("{:x}", hwnd.0 as usize)
    }

    fn window_title(hwnd: HWND) -> String {
        let len = unsafe { GetWindowTextLengthW(hwnd) };
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let written = unsafe { GetWindowTextW(hwnd, &mut buf) };
        if written <= 0 {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..written as usize])
    }

    let mut state = EnumState {
        ignore,
        frame,
        z: 0,
        child_budget: MAX_CHILD_REGIONS,
        regions: Vec::new(),
    };
    let _ = unsafe {
        EnumWindows(
            Some(enum_proc),
            LPARAM(&mut state as *mut EnumState as isize),
        )
    };
    state.regions
}
