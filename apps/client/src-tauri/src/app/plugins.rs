//! Tauri 插件注册。从 bootstrap 拆出，减轻单文件宏/类型展开压力。

use log::LevelFilter;
use tauri::{AppHandle, Manager};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

use crate::autostart;
use crate::utils::log_retention::LOG_MAX_FILE_SIZE;

/// `--verbose` / `-v` / `--debug`：把本应用（含 lancedb）降到 Debug。
///
/// 直接读 `std::env::args()` 而不是走 CLI 插件：日志级别要在 `register_plugins`
/// 里就确定，那时 `AppHandle` 还不存在，插件的 JS 侧解析也还没跑。
fn verbose_enabled() -> bool {
    std::env::args().any(|arg| is_verbose_arg(&arg))
}

/// 单个参数是否表示 verbose。
///
/// 抽成纯函数是为了让单测验证**代码本身**：旧测试对着
/// `matches!("--verbose", &[...])` 断言，等于把常量表抄了一遍，永远是绿的。
fn is_verbose_arg(arg: &str) -> bool {
    matches!(arg, "--verbose" | "-v" | "-V" | "--debug" | "--log-debug")
}

/// 依赖库默认只打 Warn+，避免 hyper/reqwest TRACE 刷屏；本 crate 走 Info（verbose 时 Debug）。
fn configure_log_levels(builder: tauri_plugin_log::Builder) -> tauri_plugin_log::Builder {
    let verbose = verbose_enabled();
    let builder = builder
        .level(if verbose {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        })
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
        .level_for("tracing_subscriber", LevelFilter::Warn)
        // arrow / lance 在 Debug 下极吵；只有 verbose 才放开到 Info
        .level_for(
            "lance",
            if verbose {
                LevelFilter::Info
            } else {
                LevelFilter::Warn
            },
        )
        .level_for(
            "lancedb",
            if verbose {
                LevelFilter::Info
            } else {
                LevelFilter::Warn
            },
        )
        .level_for(
            "object_store",
            if verbose {
                LevelFilter::Info
            } else {
                LevelFilter::Warn
            },
        );

    // 本 crate：verbose → Debug；release 也保持 Info（崩溃前的最后几条要有）
    builder.level_for(
        "cogito",
        if verbose {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        },
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbose_args_are_recognised() {
        for arg in ["--verbose", "-v", "-V", "--debug", "--log-debug"] {
            assert!(is_verbose_arg(arg), "{arg} 应视为 verbose");
        }
    }

    #[test]
    fn non_verbose_args_are_ignored() {
        for arg in ["--minimized", "-h", "", "verbose", "--verbose=false"] {
            assert!(!is_verbose_arg(arg), "{arg} 不应视为 verbose");
        }
    }
}
