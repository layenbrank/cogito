use std::sync::atomic::AtomicBool;
use tauri::{
    AppHandle, Emitter, Manager,
    image::Image,
    menu::{MenuBuilder, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

/// 全局托盘状态，通过 `app.manage()` 注入
pub struct TrayState {
    /// 是否已向用户展示过"最小化到托盘"提示（仅提示一次）
    pub notified: AtomicBool,
}

/// 在 32×32 图标右下角叠加红色方点，生成通知徽章变体
fn make_badge_icon(base_bytes: &[u8]) -> Vec<u8> {
    use image::{DynamicImage, Rgba};

    let Ok(dynamic) = image::load_from_memory(base_bytes) else {
        return base_bytes.to_vec();
    };
    let mut img = dynamic.to_rgba8();
    let (w, h) = img.dimensions();
    let dot = (w / 5).max(4);
    let ox = w.saturating_sub(dot + 2);
    let oy = h.saturating_sub(dot + 2);
    for dy in 0..dot {
        for dx in 0..dot {
            let x = ox + dx;
            let y = oy + dy;
            if x < w && y < h {
                img.put_pixel(x, y, Rgba([220, 38, 38, 255]));
            }
        }
    }
    let mut buf = Vec::new();
    if DynamicImage::ImageRgba8(img)
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .is_ok()
    {
        buf
    } else {
        base_bytes.to_vec()
    }
}

/// 初始化系统托盘，在 `Bootstrap::run` 的 setup 阶段调用
pub fn setup(app: &mut tauri::App) -> tauri::Result<()> {
    let handle = app.handle();

    // ── 右键菜单：检查更新 / 设置 / overlay / 关于 / 退出 ──────
    let check_update_item =
        MenuItem::with_id(handle, "check-update", "检查更新", true, None::<&str>)?;
    let settings_item = MenuItem::with_id(handle, "settings", "设置", true, None::<&str>)?;
    let clear_textures_item = MenuItem::with_id(
        handle,
        "overlay-clear-textures",
        "清除全部贴图",
        true,
        None::<&str>,
    )?;
    let hide_overlay_item =
        MenuItem::with_id(handle, "overlay-hide", "隐藏桌面浮层", true, None::<&str>)?;
    let overlay_devtools_item = MenuItem::with_id(
        handle,
        "overlay-devtools",
        "Overlay DevTools",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(handle)?;
    let about_item = MenuItem::with_id(handle, "about", "关于 cogito", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(handle)?;
    let quit_item = MenuItem::with_id(handle, "quit", "退出", true, None::<&str>)?;

    let menu = MenuBuilder::new(handle)
        .item(&check_update_item)
        .item(&settings_item)
        .item(&clear_textures_item)
        .item(&hide_overlay_item)
        .item(&overlay_devtools_item)
        .item(&sep1)
        .item(&about_item)
        .item(&sep2)
        .item(&quit_item)
        .build()?;

    // ── 创建托盘图标（编译期静态嵌入，ID = "main-tray"）────────
    static ICON_BYTES: &[u8] = include_bytes!("../../icons/32x32.png");
    let icon = Image::from_bytes(ICON_BYTES)?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("cogito")
        .menu(&menu)
        // 左键由 on_tray_icon_event 处理，不直接弹出菜单
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            // 左键单击 / 双击 → 切换主窗口显示/隐藏
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => toggle_main_window(tray.app_handle()),
            _ => {}
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            // 通知前端检查更新（前端监听 tray:action 事件处理）
            "check-update" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("tray:action", "check-update");
            }
            // 打开设置页
            "settings" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app.emit("tray:navigate", "/settings");
            }
            "overlay-clear-textures" => {
                let _ = app.emit("overlay://clear-textures", ());
            }
            "overlay-hide" => {
                let _ = app.emit("overlay://hide", ());
                if let Some(win) = app.get_webview_window("overlay") {
                    let _ = win.hide();
                }
            }
            "overlay-devtools" => {
                if let Some(win) = app.get_webview_window("overlay") {
                    let _ = win.show();
                    win.open_devtools();
                }
            }
            "about" => show_about(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(handle)?;

    app.manage(TrayState {
        notified: AtomicBool::new(false),
    });

    Ok(())
}

/// 左键单击：可见则隐藏，隐藏则弹出聚焦
fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
            set_badge_internal(app, false);
        }
    }
}

/// 关于对话框
fn show_about(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .message("版本: 0.1.0\n\n一个专注隐私的智能工具箱")
        .title("关于 cogito")
        .show(|_| {});
}

fn set_badge_internal(app: &AppHandle, has_badge: bool) {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return;
    };
    static ICON_BYTES: &[u8] = include_bytes!("../../icons/32x32.png");
    let bytes = if has_badge {
        make_badge_icon(ICON_BYTES)
    } else {
        ICON_BYTES.to_vec()
    };
    if let Ok(icon) = Image::from_bytes(&bytes) {
        let _ = tray.set_icon(Some(icon));
    }
}

/// 公开接口：设置 / 清除托盘图标徽章
/// 前端通过 `invoke('tray:update-badge', { hasBadge: true/false })` 调用
pub fn set_badge(app: &AppHandle, has_badge: bool) {
    set_badge_internal(app, has_badge);
}
