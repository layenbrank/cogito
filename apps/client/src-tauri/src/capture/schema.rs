use serde::Serialize;

/// 候选矩形的粒度。前端按「由细到粗」组成候选栈：
/// `element` → `child` → `client` → `frame` → `screen`
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RegionKind {
    /// UI Automation 元素（最细）
    Element,
    /// Win32 子窗口
    Child,
    /// 顶层窗口的客户区
    Client,
    /// 顶层窗口外框
    #[default]
    Frame,
    /// 整屏
    Screen,
}

/// 截图选区可吸附的候选矩形（overlay 局部逻辑像素）
#[derive(Debug, Serialize, Clone)]
pub struct CaptureRegion {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub kind: RegionKind,
    /// 所属窗口句柄（十六进制）。只用于去重/分组，不参与命中计算
    #[serde(default)]
    pub hwnd: String,
    /// 所属窗口标题
    #[serde(default)]
    pub title: String,
    /// 同层 z 序：0 = 最上层
    #[serde(default)]
    pub z: u32,
    /// 元素类型（本地化控件类型，如「按钮」）；窗口级为空
    #[serde(default)]
    pub control_type: String,
}

/// 截图结果（对齐 features/capture 前端契约）
#[derive(Debug, Serialize, Clone)]
pub struct ScreenshotResult {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
    #[serde(default)]
    pub regions: Vec<CaptureRegion>,
}
