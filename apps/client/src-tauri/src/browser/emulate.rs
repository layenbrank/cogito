//! 设备模拟：对标 VS Code 集成浏览器的 device emulation，但走宿主侧 CDP。
//!
//! 为什么不能用 DevTools：WebView2 自带的 DevTools 前端被裁掉了设备工具栏
//! （只剩「设置 → Devices」那一页，能加设备但应用不了），所以尺寸/DPR/触摸
//! /UA 只能由宿主下发 —— 这跟 `picker.rs` 借用 `Overlay` 是同一类做法。
//!
//! 两条通道（`ScaleChannel`），差别只在「谁把设备尺寸压进盒子」：
//! 1. `cdp`：`Emulation.setDeviceMetricsOverride { scale: fit }`；
//! 2. `zoom`（默认）：metrics 只管布局（width/height/dpr/mobile），缩放交给
//!    `Webview::set_zoom(fit)`（= WebView2 `ZoomFactor`）。
//!
//! 为什么默认走 `zoom`：`scale` 参数在协议里已被标记 deprecated，宿主侧调用
//! 路径少、行为不稳；`set_zoom` 是 WebView2 的公开能力，且与 metrics 的
//! `width` 叠加**不会**二次缩放 —— metrics 定布局宽（CSS px = 设备宽），
//! zoom 定「1 CSS px 占多少物理 px」，widget 宽 = 设备宽 × fit 正好吻合。
//! `probe()` 会把实测结果报给前端，UI 只显示不猜。
//!
//! 红线：这里**不碰** profile（`data_directory` / `additional_browser_args`），
//! 否则会拆出独立 WebView2 environment，登录态不再共享（见 `mod.rs`）。

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager};

use super::cdp;
use super::state::BrowserState;

/// 探针用的设备尺寸：一个典型的移动端视口
const PROBE_WIDTH: u32 = 390;
const PROBE_HEIGHT: u32 = 844;
const PROBE_DPR: f64 = 3.0;
/// 探针用的缩放值：一半，读回 `innerWidth` 应当翻倍
const PROBE_ZOOM: f64 = 0.5;
/// 探针里给 `scale` 的试探值（只验证调用是否被接受）
const PROBE_SCALE: f64 = 0.9;
/// 缩放判定的容差（px）：字体/滚动条会让读数差 1~2 px
const ZOOM_TOLERANCE: f64 = 4.0;

/// fit 下限：再小就没有可读性，盒子里直接按「面板太窄」处理
const MIN_FIT: f64 = 0.1;
const MAX_FIT: f64 = 1.0;
/// 触摸模拟的手指数：与 DevTools 默认一致
const TOUCH_POINTS: u32 = 5;

// ---------------------------------------------------------------------------
// 设备档案
// ---------------------------------------------------------------------------

/// 一份设备档案。字段语义：
/// - `dpr = None` → 不覆盖 `devicePixelRatio`（跟随系统，桌面模式用）；
/// - `user_agent = None` → 不发 `setUserAgentOverride`（保持桌面 UA）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceProfile {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub dpr: Option<f64>,
    #[serde(default = "default_mobile")]
    pub mobile: bool,
    #[serde(default)]
    pub user_agent: Option<String>,
}

fn default_mobile() -> bool {
    true
}

impl DeviceProfile {
    /// 宽高为 0 的档案会让 `setDeviceMetricsOverride` 直接报错，提前拦掉
    pub fn validate(&self) -> Result<(), String> {
        if self.width == 0 || self.height == 0 {
            return Err("设备宽高必须大于 0".to_string());
        }
        if self.width > 10_000 || self.height > 10_000 {
            return Err("设备宽高超出合理范围（≤ 10000）".to_string());
        }
        Ok(())
    }
}

const UA_IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_IPHONE_SE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";
const UA_IPAD: &str = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_PIXEL: &str = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const UA_ANDROID: &str = "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

fn profile(
    width: u32,
    height: u32,
    dpr: Option<f64>,
    mobile: bool,
    user_agent: Option<&str>,
) -> DeviceProfile {
    DeviceProfile {
        width,
        height,
        dpr,
        mobile,
        user_agent: user_agent.map(str::to_string),
    }
}

/// 预设表：id 与前端 `DEVICE_PRESETS` 一一对应（前端负责显示名，这里只管参数）。
///
/// `id` 允许宽松写法（大小写 / `-` / `_` / 空格都归一），agent 传
/// `"iPhone 15 Pro"` 也能命中。
#[must_use]
pub fn preset(id: &str) -> Option<DeviceProfile> {
    let normalized: String = id
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_' && *ch != ' ')
        .flat_map(char::to_lowercase)
        .collect();
    let device = match normalized.as_str() {
        "iphone15pro" => profile(393, 852, Some(3.0), true, Some(UA_IPHONE)),
        "iphonese" => profile(375, 667, Some(2.0), true, Some(UA_IPHONE_SE)),
        "pixel8" => profile(412, 915, Some(2.625), true, Some(UA_PIXEL)),
        "ipadmini" => profile(768, 1024, Some(2.0), true, Some(UA_IPAD)),
        "android" | "android360" => profile(360, 780, Some(3.0), true, Some(UA_ANDROID)),
        "desktop" => profile(1440, 900, None, false, None),
        _ => return None,
    };
    Some(device)
}

/// 预设 id 列表（给 agent 的报错信息用）
#[must_use]
pub fn preset_ids() -> &'static [&'static str] {
    &[
        "iphone-15-pro",
        "iphone-se",
        "pixel-8",
        "ipad-mini",
        "android",
        "desktop",
    ]
}

// ---------------------------------------------------------------------------
// 缩放通道
// ---------------------------------------------------------------------------

/// 缩放通道：决定 `apply()` 把 fit 交给谁
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScaleChannel {
    /// CDP `Emulation.setDeviceMetricsOverride.scale`
    Cdp,
    /// `Webview::set_zoom(fit)`（默认）
    Zoom,
    /// 都不行：设备比面板大时只能裁剪
    None,
}

impl ScaleChannel {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            ScaleChannel::Cdp => "cdp",
            ScaleChannel::Zoom => "zoom",
            ScaleChannel::None => "none",
        }
    }
}

fn channel_cell() -> &'static Mutex<ScaleChannel> {
    static CELL: OnceLock<Mutex<ScaleChannel>> = OnceLock::new();
    CELL.get_or_init(|| Mutex::new(ScaleChannel::Cdp))
}

/// 当前生效的缩放通道。探针没跑过时按 `Cdp` 兜底（DevTools 同路径：一次
/// `setDeviceMetricsOverride` 同时定布局与缩放）；`apply()` 里 scale 被拒会
/// 自动退到 `Zoom` 并改写这里，所以默认值不生效时也能自愈。
#[must_use]
pub fn channel() -> ScaleChannel {
    *channel_cell()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_channel(next: ScaleChannel) {
    *channel_cell()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = next;
}

/// 每个 tab 最后一次应用的 fit：导航重放 / 拾取恢复时要用它，
/// 而 fit 由前端按面板尺寸算，Rust 侧不复算。
fn fits() -> &'static Mutex<HashMap<String, f64>> {
    static FITS: OnceLock<Mutex<HashMap<String, f64>>> = OnceLock::new();
    FITS.get_or_init(Mutex::default)
}

fn with_fits<T>(action: impl FnOnce(&mut HashMap<String, f64>) -> T) -> T {
    let mut guard = fits()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

fn panels() -> &'static Mutex<HashMap<String, (f64, f64)>> {
    static PANELS: OnceLock<Mutex<HashMap<String, (f64, f64)>>> = OnceLock::new();
    PANELS.get_or_init(Mutex::default)
}

fn with_panels<T>(action: impl FnOnce(&mut HashMap<String, (f64, f64)>) -> T) -> T {
    let mut guard = panels()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    action(&mut guard)
}

/// 记下「设备盒子」可用尺寸（≈ 面板可用区），供 agent `estimate_fit` 使用。
pub fn remember_panel(label: &str, width: f64, height: f64) {
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    with_panels(|map| {
        map.insert(label.to_string(), (width, height));
    });
}

/// tab 关闭 / 被判定为孤儿时清账
pub fn forget(label: &str) {
    with_fits(|map| map.remove(label));
    with_panels(|map| map.remove(label));
}

#[must_use]
pub fn fit_of(label: &str) -> Option<f64> {
    with_fits(|map| map.get(label).copied())
}

#[must_use]
pub fn panel_of(label: &str) -> Option<(f64, f64)> {
    with_panels(|map| map.get(label).copied())
}

// ---------------------------------------------------------------------------
// 纯函数：参数拼装（单测覆盖）
// ---------------------------------------------------------------------------

/// 把外部传入的 fit 夹到 `[0.1, 1]`；NaN / 无穷按 1 处理（不缩放永远安全）
#[must_use]
pub fn clamp_fit(fit: f64) -> f64 {
    if !fit.is_finite() {
        return MAX_FIT;
    }
    fit.clamp(MIN_FIT, MAX_FIT)
}

/// `Emulation.setDeviceMetricsOverride` 的参数。
///
/// - `deviceScaleFactor: 0` 表示「不覆盖 DPR」（CDP 约定）；
/// - `scale` 只在 `cdp` 通道带，`zoom` 通道的缩放由 `set_zoom` 负责，
///   两个一起用会二次缩放。
#[must_use]
pub fn metrics_params(device: &DeviceProfile, fit: f64, channel: ScaleChannel) -> Value {
    let portrait = device.height >= device.width;
    let mut params = json!({
        "width": device.width,
        "height": device.height,
        "deviceScaleFactor": device.dpr.unwrap_or(0.0),
        "mobile": device.mobile,
        "screenWidth": device.width,
        "screenHeight": device.height,
        "screenOrientation": {
            "type": if portrait { "portraitPrimary" } else { "landscapePrimary" },
            "angle": if portrait { 0 } else { 90 }
        }
    });
    if channel == ScaleChannel::Cdp {
        params["scale"] = json!(clamp_fit(fit));
    }
    params
}

/// `Emulation.setEmulatedMedia` 的 features：移动端要 `pointer: coarse` + `hover: none`，
/// 桌面端传空数组表示「清掉上一轮的覆盖」。
#[must_use]
pub fn media_features(device: &DeviceProfile) -> Value {
    if !device.mobile {
        return json!([]);
    }
    json!([
        { "name": "pointer", "value": "coarse" },
        { "name": "hover", "value": "none" },
        { "name": "any-pointer", "value": "coarse" },
        { "name": "any-hover", "value": "none" }
    ])
}

/// `Emulation.setUserAgentOverride` 的参数；UA 为空/缺省时返回 `None`
/// （调用方改成「复位桌面 UA」，而不是拿空串去覆盖）。
#[must_use]
pub fn ua_params(device: &DeviceProfile) -> Option<Value> {
    let user_agent = device.user_agent.as_deref()?.trim();
    if user_agent.is_empty() {
        return None;
    }
    Some(json!({
        "userAgent": user_agent,
        "userAgentMetadata": ua_metadata(device, user_agent)
    }))
}

/// UA-CH（`navigator.userAgentData`）的元数据。
///
/// 只发 `userAgent` 的话 `navigator.userAgentData.mobile` 仍是桌面值，
/// 页面里按 client hints 分流的分支就验不到 —— 所以这里显式补一份。
#[must_use]
pub fn ua_metadata(device: &DeviceProfile, user_agent: &str) -> Value {
    let lower = user_agent.to_ascii_lowercase();
    // 机型是动态拼的，其余是常量 —— 统一成 String 免得走不通类型推导
    let (platform, model, platform_version, full_version): (&str, String, &str, &str) =
        if lower.contains("iphone") {
            ("iOS", "iPhone".to_string(), "17.5", "17.5")
        } else if lower.contains("ipad") {
            ("iOS", "iPad".to_string(), "17.5", "17.5")
        } else if lower.contains("android") {
            ("Android", android_model(user_agent), "14", "126.0.0.0")
        } else {
            ("Windows", String::new(), "10.0.0", "126.0.0.0")
        };
    let major = full_version.split('.').next().unwrap_or(full_version);
    json!({
        "brands": [{ "brand": "Chromium", "version": major }],
        "fullVersionList": [{ "brand": "Chromium", "version": full_version }],
        "fullVersion": full_version,
        "platform": platform,
        "platformVersion": platform_version,
        "architecture": "",
        "model": model,
        "mobile": device.mobile
    })
}

/// 从 Android UA 里抠机型：`(Linux; Android 14; Pixel 8)` → `Pixel 8`
///
/// 必须先把**第一对括号**里的内容切出来：UA 里 `AppleWebKit/537.36 (KHTML, ...)`
/// 还有一对括号，直接按 `('(')` / `')'` 取会带上一段尾巴。
fn android_model(user_agent: &str) -> String {
    let Some(start) = user_agent.find('(') else {
        return String::new();
    };
    let rest = &user_agent[start + 1..];
    let inner = rest.split(')').next().unwrap_or(rest);
    inner
        .split(';')
        .next_back()
        .map(|model| model.trim().to_string())
        .unwrap_or_default()
}

/// 退出模拟要下发的复原命令（顺序有意义：先摘 metrics，再收语义）。
///
/// 单独抽成函数是为了让「退出是否干净」可被单测锁定 —— 这些方法名一旦漏一个，
/// 页面就会残留移动 UA / 触摸合成。
#[must_use]
pub fn clear_commands() -> Vec<(&'static str, Value)> {
    vec![
        ("Emulation.clearDeviceMetricsOverride", json!({})),
        (
            "Emulation.setTouchEmulationEnabled",
            json!({ "enabled": false }),
        ),
        ("Emulation.setEmulatedMedia", json!({ "features": [] })),
        (
            "Emulation.setEmitTouchEventsForMouse",
            json!({ "enabled": false }),
        ),
        ("Emulation.setUserAgentOverride", json!({ "userAgent": "" })),
    ]
}

/// `setEmitTouchEventsForMouse` 的参数：移动端把鼠标事件合成 touch
fn emit_touch_params(mobile: bool) -> Value {
    if mobile {
        json!({ "enabled": true, "configuration": "mobile" })
    } else {
        json!({ "enabled": false })
    }
}

// ---------------------------------------------------------------------------
// 与页面交互
// ---------------------------------------------------------------------------

fn set_zoom(app: &AppHandle, label: &str, zoom: f64) -> Result<(), String> {
    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("没有这个 tab：{label}"))?;
    webview
        .set_zoom(zoom)
        .map_err(|error| format!("设置缩放失败：{error}"))
}

/// 读一个数字表达式（`Runtime.evaluate` 的 `result.value`）
async fn eval_number(app: &AppHandle, label: &str, expression: &str) -> Result<f64, String> {
    let response = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true }),
    )
    .await?;
    if let Some(details) = response.get("exceptionDetails") {
        return Err(format!("读取页面数据失败：{details}"));
    }
    response
        .get("result")
        .and_then(|result| result.get("value"))
        .and_then(Value::as_f64)
        .ok_or_else(|| "页面数据不是数字".to_string())
}

/// 读一段返回对象的脚本（原样返回 JSON）
async fn eval_object(app: &AppHandle, label: &str, expression: &str) -> Result<Value, String> {
    let response = cdp::call(
        app,
        label,
        "Runtime.evaluate",
        json!({ "expression": expression, "returnByValue": true }),
    )
    .await?;
    if let Some(details) = response.get("exceptionDetails") {
        return Err(format!("读取页面数据失败：{details}"));
    }
    Ok(response
        .get("result")
        .and_then(|result| result.get("value"))
        .cloned()
        .unwrap_or(Value::Null))
}

/// 页面自报的视口参数 —— 「模拟到底生效没有」的唯一判据。
///
/// 面板角标、agent 的 `app_browser_device` 返回、探针都读它，避免三处各算一套。
pub async fn readback(app: &AppHandle, label: &str) -> Result<Value, String> {
    eval_object(
        app,
        label,
        r#"(() => ({
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            dpr: window.devicePixelRatio,
            pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
            hoverNone: window.matchMedia('(hover: none)').matches,
            mobileUaData: navigator.userAgentData ? navigator.userAgentData.mobile === true : null,
            userAgent: navigator.userAgent
        }))()"#,
    )
    .await
}

// ---------------------------------------------------------------------------
// 应用 / 恢复
// ---------------------------------------------------------------------------

/// 仅 fit 变了：跳过 UA / 触摸 / media，只改缩放（面板拖拽热路径）。
async fn apply_fit_only(
    app: &AppHandle,
    label: &str,
    device: &DeviceProfile,
    fit: f64,
) -> Result<(), String> {
    let fit = clamp_fit(fit);
    with_fits(|map| map.insert(label.to_string(), fit));
    remember_panel(
        label,
        f64::from(device.width) * fit,
        f64::from(device.height) * fit,
    );
    let channel = channel();
    match channel {
        ScaleChannel::Cdp => {
            cdp::call(
                app,
                label,
                "Emulation.setDeviceMetricsOverride",
                metrics_params(device, fit, channel),
            )
            .await?;
            if let Err(error) = set_zoom(app, label, MAX_FIT) {
                log::warn!("browser: fit-only 复位缩放失败（{label}）: {error}");
            }
        }
        ScaleChannel::Zoom => {
            if let Err(error) = set_zoom(app, label, fit) {
                log::warn!("browser: fit-only 设置缩放失败（{label}，zoom={fit}）: {error}");
            }
        }
        ScaleChannel::None => {}
    }
    log::debug!(
        "browser: fit-only {label} → fit={fit:.2} channel={}",
        channel.as_str()
    );
    Ok(())
}

/// 应用（或退出）设备模拟。
///
/// `device = None` 走清除路径；`Some` 依次下发 metrics → 触摸 → media → 鼠标合成 →
/// UA → 缩放。`fit` 由前端算（盒子 / 设备），这里只做夹取与记账。
///
/// 若档案未变、仅 fit 变了，走 `apply_fit_only`，避免拖面板时反复重灌 UA/触摸。
pub async fn apply(
    app: &AppHandle,
    label: &str,
    device: Option<&DeviceProfile>,
    fit: f64,
) -> Result<(), String> {
    let Some(device) = device else {
        forget(label);
        cleanup_emulation(app, label).await;
        return Ok(());
    };
    device.validate()?;

    let fit = clamp_fit(fit);
    let previous = device_of(app, label);
    let previous_fit = fit_of(label);
    if previous.as_ref() == Some(device) {
        if previous_fit.is_some_and(|old| (old - fit).abs() < 1e-9) {
            return Ok(());
        }
        return apply_fit_only(app, label, device, fit).await;
    }

    with_fits(|map| map.insert(label.to_string(), fit));
    remember_panel(
        label,
        f64::from(device.width) * fit,
        f64::from(device.height) * fit,
    );

    // `scale` 在部分 WebView2 版本会被拒：失败就退到 zoom 通道自愈，
    // 不用等用户去点一次自检。
    let mut channel = channel();
    let metrics = metrics_params(device, fit, channel);
    if let Err(error) = cdp::call(app, label, "Emulation.setDeviceMetricsOverride", metrics).await {
        if channel != ScaleChannel::Cdp {
            return Err(error);
        }
        log::warn!("browser: CDP scale 被拒（{label}），退到 zoom 通道: {error}");
        channel = ScaleChannel::Zoom;
        set_channel(channel);
        cdp::call(
            app,
            label,
            "Emulation.setDeviceMetricsOverride",
            metrics_params(device, fit, channel),
        )
        .await?;
    }

    cdp::call(
        app,
        label,
        "Emulation.setTouchEmulationEnabled",
        json!({
            "enabled": device.mobile,
            "maxTouchPoints": if device.mobile { TOUCH_POINTS } else { 1 }
        }),
    )
    .await?;

    cdp::call(
        app,
        label,
        "Emulation.setEmulatedMedia",
        json!({ "features": media_features(device) }),
    )
    .await?;

    // 拾取期间不合成 touch：hover 会失效，Overlay 的高亮跟不了手（见 picker.rs）
    cdp::call(
        app,
        label,
        "Emulation.setEmitTouchEventsForMouse",
        emit_touch_params(device.mobile && !super::picker::is_active(label)),
    )
    .await?;

    match ua_params(device) {
        Some(params) => {
            cdp::call(app, label, "Emulation.setUserAgentOverride", params).await?;
        }
        None => {
            cdp::call(
                app,
                label,
                "Emulation.setUserAgentOverride",
                json!({ "userAgent": "" }),
            )
            .await?;
        }
    }

    // 缩放：只有 zoom 通道归 `set_zoom` 管；其余情况一律复位成 1，避免上一轮残留
    let zoom = if channel == ScaleChannel::Zoom {
        fit
    } else {
        MAX_FIT
    };
    if let Err(error) = set_zoom(app, label, zoom) {
        // 设备比面板小的时候缩放失败只影响观感，不该把整个模拟判失败
        log::warn!("browser: 设置缩放失败（{label}，zoom={zoom}）: {error}");
    }
    log::info!(
        "browser: 设备模拟 {label} → {}x{}@{} mobile={} fit={fit:.2} channel={}",
        device.width,
        device.height,
        device.dpr.unwrap_or(0.0),
        device.mobile,
        channel.as_str()
    );
    Ok(())
}

/// 页面加载后重放：硬导航会重置 override（per-target），而状态在 Rust 里。
pub async fn replay(app: &AppHandle, label: &str) {
    let Some(device) = device_of(app, label) else {
        return;
    };
    let fit = fit_of(label).unwrap_or(MAX_FIT);
    if let Err(error) = apply(app, label, Some(&device), fit).await {
        log::warn!("browser: 导航后重放设备模拟失败（{label}）: {error}");
    }
}

/// 从 `BrowserState` 取这个 tab 的设备档案（真相源，不在本模块重复存）
fn device_of(app: &AppHandle, label: &str) -> Option<DeviceProfile> {
    let state = app.try_state::<BrowserState>()?;
    state.tab(label)?.device
}

/// 拾取开始：临时关掉鼠标→touch 合成，否则 hover 高亮不跟手
pub async fn suspend_mouse(app: &AppHandle, label: &str) -> Result<(), String> {
    cdp::call(
        app,
        label,
        "Emulation.setEmitTouchEventsForMouse",
        emit_touch_params(false),
    )
    .await
    .map(|_| ())
}

/// 拾取结束：有设备才恢复（桌面态什么都没发生）
///
/// 走整条 `replay` 而不是只补一条 `setEmitTouchEventsForMouse`：拾取期间
/// `stop()` 还清过高亮、导航可能刚重置过 override，重放一次最稳。
pub async fn resume_mouse(app: &AppHandle, label: &str) {
    if device_of(app, label).is_none() {
        return;
    }
    replay(app, label).await;
}

/// 摘掉本轮模拟留下的所有覆盖（探测收尾 / 退出模拟都走它）
pub async fn cleanup_emulation(app: &AppHandle, label: &str) {
    for (method, params) in clear_commands() {
        let _ = cdp::call(app, label, method, params).await;
    }
    if let Err(error) = set_zoom(app, label, MAX_FIT) {
        log::warn!("browser: 复原缩放失败（{label}）: {error}");
    }
}

// ---------------------------------------------------------------------------
// 探针
// ---------------------------------------------------------------------------

/// 能力探测的结论：`probe()` 的返回值就是它的 JSON 形状
struct Capability {
    can_emulate: bool,
    zoom_ok: bool,
    scale_accepted: bool,
    channel: ScaleChannel,
}

/// 通道优先级：`scale` 能用就用它（与 DevTools 同路径，一次调用同时定布局和缩放）；
/// 被拒再退 `set_zoom`；两个都不行只能裁剪（`None`）。
fn capability_of(can_emulate: bool, scale_accepted: bool, zoom_ok: bool) -> Capability {
    let channel = if !can_emulate {
        ScaleChannel::None
    } else if scale_accepted {
        ScaleChannel::Cdp
    } else if zoom_ok {
        ScaleChannel::Zoom
    } else {
        ScaleChannel::None
    };
    Capability {
        can_emulate,
        zoom_ok,
        scale_accepted,
        channel,
    }
}

/// 能力探测：`canEmulate` + 缩放往返 + 一次真实 metrics 覆盖，跑完复原。
///
/// 前端在「自检」里看这条路通不通；结果里的 `scaleChannel` 就是后续
/// `apply()` 该走的通道。探测过程**会短暂改页面状态**（改 zoom、套一次
/// 390×844），所以无论成功失败都必须把状态收回去，有设备时再重放回来。
pub async fn probe(app: &AppHandle, label: &str) -> Value {
    let mut report = Map::new();

    // 1) 缩放通道：zoom=1 读一次基线，zoom=0.5 再读一次，innerWidth 应翻倍
    let baseline = eval_number(app, label, "window.innerWidth").await;
    let zoom_test = match baseline {
        Err(error) => Err(error),
        Ok(baseline) => {
            let outcome = run_zoom_roundtrip(app, label, baseline).await;
            // 先还原缩放，无论成败
            if let Err(error) = set_zoom(app, label, MAX_FIT) {
                log::warn!("browser: 探针复原缩放失败（{label}）: {error}");
            }
            outcome
        }
    };
    let zoom_ok = matches!(zoom_test, Ok(_));

    // 2) metrics：能不能 cover（WebView2 未必开放这个域）
    let can_emulate = matches!(
        cdp::call(app, label, "Emulation.canEmulate", json!({})).await,
        Ok(value) if value.get("result").and_then(Value::as_bool).unwrap_or(false)
    );

    // 3) 真套一次 390×844@3 mobile（带 scale 试探），读回页面自报的视口
    let metrics = probe_metrics(app, label).await;

    // 4) 复原：摘掉覆盖，回到桌面态
    cleanup_emulation(app, label).await;

    let scale_accepted = metrics
        .get("scaleAccepted")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let capability = capability_of(can_emulate, scale_accepted, zoom_ok);
    set_channel(capability.channel);

    let metrics_ok = metrics
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let readback = metrics
        .get("readback")
        .cloned()
        .unwrap_or(Value::Null);

    report.insert("ok".into(), json!(metrics_ok));
    report.insert("canEmulate".into(), json!(capability.can_emulate));
    report.insert("scaleAccepted".into(), json!(capability.scale_accepted));
    report.insert("zoomOk".into(), json!(capability.zoom_ok));
    report.insert("scaleChannel".into(), json!(capability.channel.as_str()));
    report.insert("metrics".into(), metrics);
    report.insert("readback".into(), readback);
    report.insert(
        "zoom".into(),
        match zoom_test {
            Ok(test) => json!({ "ok": true, "baseline": test.baseline, "scaled": test.scaled }),
            Err(error) => json!({ "ok": false, "error": error }),
        },
    );

    // 探针把覆盖摘了，但用户的设备模拟还在 —— 重放一次，别让自检顺手关掉模拟
    replay(app, label).await;

    Value::Object(report)
}

struct ZoomTest {
    baseline: f64,
    scaled: f64,
}

async fn run_zoom_roundtrip(
    app: &AppHandle,
    label: &str,
    baseline: f64,
) -> Result<ZoomTest, String> {
    if baseline < 1.0 {
        return Err("页面还没有布局（innerWidth 为 0）".to_string());
    }
    set_zoom(app, label, MAX_FIT)?;
    let reset = eval_number(app, label, "window.innerWidth").await?;
    set_zoom(app, label, PROBE_ZOOM)?;
    let scaled = eval_number(app, label, "window.innerWidth").await?;
    let expected = reset / PROBE_ZOOM;
    if (scaled - expected).abs() > ZOOM_TOLERANCE {
        return Err(format!("缩放没有生效：期望 {expected:.0}，实际 {scaled:.0}"));
    }
    Ok(ZoomTest {
        baseline: reset,
        scaled,
    })
}

async fn probe_metrics(app: &AppHandle, label: &str) -> Value {
    let device = profile(PROBE_WIDTH, PROBE_HEIGHT, Some(PROBE_DPR), true, None);
    let mut params = metrics_params(&device, PROBE_SCALE, ScaleChannel::Cdp);

    // `scale` 在 WebView2 上未必被接受：先带它试一次，被拒就退到纯布局
    let scaled = cdp::call(
        app,
        label,
        "Emulation.setDeviceMetricsOverride",
        params.clone(),
    )
    .await;
    let mut scale_accepted = scaled.is_ok();
    if let Err(error) = scaled {
        log::info!("browser: 探针的 scale 参数被拒（{label}），退到纯布局覆盖: {error}");
        if let Some(object) = params.as_object_mut() {
            object.remove("scale");
        }
        scale_accepted = false;
        if let Err(error) = cdp::call(
            app,
            label,
            "Emulation.setDeviceMetricsOverride",
            params,
        )
        .await
        {
            return json!({ "ok": false, "error": error, "scaleAccepted": false });
        }
    }

    match readback(app, label).await {
        Ok(value) => {
            let width = value.get("innerWidth").and_then(Value::as_f64).unwrap_or(0.0);
            let dpr = value.get("dpr").and_then(Value::as_f64).unwrap_or(0.0);
            let coarse = value
                .get("pointerCoarse")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let ok = (width - f64::from(PROBE_WIDTH)).abs() <= 1.0
                && (dpr - PROBE_DPR).abs() < 0.01
                && coarse;
            json!({
                "ok": ok,
                "scaleAccepted": scale_accepted,
                "readback": value
            })
        }
        Err(error) => json!({
            "ok": false,
            "scaleAccepted": scale_accepted,
            "error": error
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phone() -> DeviceProfile {
        profile(390, 844, Some(3.0), true, Some(UA_IPHONE))
    }

    fn desktop() -> DeviceProfile {
        profile(1440, 900, None, false, None)
    }

    #[test]
    fn clamp_fit_stays_in_range() {
        assert!((clamp_fit(0.0) - 0.1).abs() < 1e-9);
        assert!((clamp_fit(-3.0) - 0.1).abs() < 1e-9);
        assert!((clamp_fit(1.0) - 1.0).abs() < 1e-9);
        assert!((clamp_fit(4.0) - 1.0).abs() < 1e-9);
        assert!((clamp_fit(f64::NAN) - 1.0).abs() < 1e-9);
        assert!((clamp_fit(0.42) - 0.42).abs() < 1e-9);
    }

    #[test]
    fn metrics_params_follow_the_channel() {
        let cdp = metrics_params(&phone(), 0.5, ScaleChannel::Cdp);
        assert_eq!(cdp["width"], 390);
        assert_eq!(cdp["height"], 844);
        assert_eq!(cdp["deviceScaleFactor"], 3.0);
        assert_eq!(cdp["mobile"], true);
        assert_eq!(cdp["screenWidth"], 390);
        assert_eq!(cdp["screenOrientation"]["type"], "portraitPrimary");
        assert_eq!(cdp["scale"], 0.5);

        // zoom 通道不带 scale：缩放交给 set_zoom，两个一起用会二次缩放
        let zoom = metrics_params(&phone(), 0.5, ScaleChannel::Zoom);
        assert!(zoom.get("scale").is_none());
        assert_eq!(zoom["width"], 390);
    }

    #[test]
    fn metrics_params_omit_dpr_when_absent() {
        // CDP 约定：deviceScaleFactor = 0 表示不覆盖
        let params = metrics_params(&desktop(), 1.0, ScaleChannel::Zoom);
        assert_eq!(params["deviceScaleFactor"], 0.0);
        assert_eq!(params["screenOrientation"]["type"], "landscapePrimary");
        assert_eq!(params["screenOrientation"]["angle"], 90);
    }

    #[test]
    fn clamp_fit_is_applied_to_scale() {
        let params = metrics_params(&phone(), 9.0, ScaleChannel::Cdp);
        assert_eq!(params["scale"], 1.0);
        let params = metrics_params(&phone(), 0.01, ScaleChannel::Cdp);
        assert_eq!(params["scale"], 0.1);
    }

    #[test]
    fn media_features_follow_mobile() {
        let mobile = media_features(&phone());
        let list = mobile.as_array().expect("features 必须是数组");
        assert_eq!(list.len(), 4);
        assert!(list.iter().any(|item| item["name"] == "pointer" && item["value"] == "coarse"));
        assert!(list.iter().any(|item| item["name"] == "hover" && item["value"] == "none"));

        // 桌面端传空数组 = 清掉上一轮的覆盖
        assert_eq!(media_features(&desktop()), json!([]));
    }

    #[test]
    fn ua_override_is_skipped_when_empty() {
        let mut device = phone();
        assert!(ua_params(&device).is_some());

        device.user_agent = Some("   ".to_string());
        assert!(ua_params(&device).is_none());

        device.user_agent = None;
        assert!(ua_params(&device).is_none());
    }

    #[test]
    fn ua_metadata_marks_mobile_and_platform() {
        let params = ua_params(&phone()).expect("iPhone 档案应当带 UA");
        let metadata = &params["userAgentMetadata"];
        assert_eq!(metadata["mobile"], true);
        assert_eq!(metadata["platform"], "iOS");
        assert_eq!(metadata["model"], "iPhone");

        let pixel = preset("pixel-8").expect("Pixel 预设");
        let metadata = ua_metadata(&pixel, pixel.user_agent.as_deref().unwrap());
        assert_eq!(metadata["platform"], "Android");
        assert_eq!(metadata["model"], "Pixel 8");
        assert_eq!(metadata["mobile"], true);

        // 桌面档案没有 UA，元数据里的 mobile 也必须是 false
        let metadata = ua_metadata(&desktop(), UA_ANDROID);
        assert_eq!(metadata["mobile"], false);
    }

    #[test]
    fn android_model_only_reads_the_first_parenthesis() {
        assert_eq!(
            android_model(UA_PIXEL),
            "Pixel 8",
            "UA 里第二对括号不能混进机型"
        );
        assert_eq!(android_model(UA_ANDROID), "SM-G991B");
        // 桌面 UA 没有括号 → 空串（宁可留空，也不要往 metadata 里塞垃圾）
        assert_eq!(android_model("curl/8.0"), "");
    }

    #[test]
    fn presets_cover_the_documented_ids() {
        for id in preset_ids() {
            assert!(preset(id).is_some(), "预设 {id} 找不到");
        }
        // agent 传显示名也要能命中
        assert!(preset("iPhone 15 Pro").is_some());
        assert!(preset("IPHONE_15_PRO").is_some());
        assert!(preset("nope").is_none());

        let iphone = preset("iphone-15-pro").expect("iPhone 预设");
        assert_eq!((iphone.width, iphone.height), (393, 852));
        assert_eq!(iphone.dpr, Some(3.0));
        assert!(iphone.mobile);

        let desktop = preset("desktop").expect("桌面预设");
        assert!(!desktop.mobile);
        assert!(desktop.dpr.is_none());
        assert!(desktop.user_agent.is_none());
    }

    #[test]
    fn invalid_profiles_are_rejected() {
        let mut zero = phone();
        zero.width = 0;
        assert!(zero.validate().is_err());

        let mut huge = phone();
        huge.height = 20_000;
        assert!(huge.validate().is_err());

        assert!(phone().validate().is_ok());
    }

    #[test]
    fn emit_touch_follows_mobile() {
        assert_eq!(emit_touch_params(true)["configuration"], "mobile");
        assert_eq!(emit_touch_params(true)["enabled"], true);
        // 关闭时只发 enabled，configuration 没意义
        assert!(emit_touch_params(false).get("configuration").is_none());
        assert_eq!(emit_touch_params(false)["enabled"], false);
    }

    #[test]
    fn clear_covers_every_override() {
        let commands = clear_commands();
        let names: Vec<&str> = commands.iter().map(|(name, _)| *name).collect();
        assert_eq!(
            names,
            vec![
                "Emulation.clearDeviceMetricsOverride",
                "Emulation.setTouchEmulationEnabled",
                "Emulation.setEmulatedMedia",
                "Emulation.setEmitTouchEventsForMouse",
                "Emulation.setUserAgentOverride",
            ]
        );
        // 先摘 metrics，再收语义
        assert_eq!(commands[0].0, "Emulation.clearDeviceMetricsOverride");
        // UA 复位是空串，不是随便一个桌面 UA
        assert_eq!(commands[4].1["userAgent"], "");
        assert_eq!(commands[1].1["enabled"], false);
        assert_eq!(commands[3].1["enabled"], false);
        assert_eq!(commands[2].1["features"], json!([]));
    }

    #[test]
    fn channel_prefers_cdp_then_falls_back() {
        // 默认走 CDP：scale 与 DevTools 同路径，被拒时 `apply` 会自愈到 zoom
        assert_eq!(channel(), ScaleChannel::Cdp);
        assert_eq!(capability_of(true, true, true).channel, ScaleChannel::Cdp);
        assert_eq!(capability_of(true, false, true).channel, ScaleChannel::Zoom);
        assert_eq!(capability_of(true, false, false).channel, ScaleChannel::None);
        // 连 Emulation 域都没有：什么都不覆盖，UI 只能提示
        assert_eq!(capability_of(false, true, true).channel, ScaleChannel::None);
        assert_eq!(capability_of(false, false, false).channel, ScaleChannel::None);

        let capability = capability_of(true, true, true);
        assert!(capability.can_emulate);
        assert!(capability.scale_accepted);
        assert!(capability.zoom_ok);

        assert_eq!(ScaleChannel::Cdp.as_str(), "cdp");
        assert_eq!(ScaleChannel::Zoom.as_str(), "zoom");
        assert_eq!(ScaleChannel::None.as_str(), "none");
    }
}
