//! Tauri 插件注册。从 bootstrap 拆出，减轻单文件宏/类型展开压力。

use log::LevelFilter;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

use crate::autostart;
use crate::utils::log_retention::LOG_MAX_FILE_SIZE;

/// 依赖库默认只打 Warn+，避免 hyper/reqwest TRACE 刷屏；本 crate 在 debug 下仍可 Debug。
fn configure_log_levels(builder: tauri_plugin_log::Builder) -> tauri_plugin_log::Builder {
    let builder = builder
        .level(LevelFilter::Info)
        .level_for("hyper", LevelFilter::Warn)
        .level_for("hyper_util", LevelFilter::Warn)
        .level_for("reqwest", LevelFilter::Warn)
        .level_for("rustls", LevelFilter::Warn)
        .level_for("h2", LevelFilter::Warn)
        .level_for("tower", LevelFilter::Warn)
        .level_for("tokio_util", LevelFilter::Warn)
        .level_for("want", LevelFilter::Warn)
        .level_for("mio", LevelFilter::Warn)
        .level_for("tracing", LevelFilter::Warn)
        .level_for("tracing_subscriber", LevelFilter::Warn);

    #[cfg(debug_assertions)]
    let builder = builder
        .level_for("thinking", LevelFilter::Debug)
        .level_for("cogito", LevelFilter::Debug);

    builder
}

/// 为 Builder 挂载桌面端通用插件。
pub fn register_plugins(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    let log_builder = configure_log_levels(
        tauri_plugin_log::Builder::new()
            .clear_targets()
            .rotation_strategy(RotationStrategy::KeepAll)
            .max_file_size(LOG_MAX_FILE_SIZE)
            .timezone_strategy(TimezoneStrategy::UseLocal)
            .target(Target::new(TargetKind::Stdout))
            .target(Target::new(TargetKind::LogDir { file_name: None })),
    );

    let builder = builder
        .plugin(log_builder.build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    autostart::register(builder)
}

fn focus_main_window(app: &AppHandle) {
    let _ = app
        .get_webview_window("main")
        .expect("no main window")
        .set_focus();
}
