use std::time::Duration;

use tauri::{Manager, RunEvent, generate_context};
use thinking_database::{Storage, database_path, initialize, migration};

use crate::{
    app::{handlers, plugins},
    autostart,
    capture::CapturePending,
    navigation::NavigationState,
    overlay::{OverlayHealth, OverlayPending},
    reminder,
    through::{self, ThroughState},
    ui::tray,
    utils::{
        goose_acp::GooseAcpHub,
        goose_serve::{self, GooseServeState},
        goose_tls, log_retention,
        sidecar::{self, SidecarState},
        terminal::TerminalHub,
    },
};

pub struct Bootstrap;

impl Bootstrap {
    #[cfg_attr(mobile, tauri::mobile_entry_point)]
    pub fn run() {
        let builder = plugins::register_plugins(tauri::Builder::default());

        builder
            .setup(move |app| {
                let handle_for_db = app.handle().clone();
                let db_state = tauri::async_runtime::block_on(async move {
                    let app_dir = handle_for_db
                        .path()
                        .app_local_data_dir()
                        .map_err(|e| anyhow::anyhow!("获取应用数据目录失败: {}", e))?;
                    std::fs::create_dir_all(&app_dir)
                        .map_err(|e| anyhow::anyhow!("创建应用数据目录失败: {}", e))?;
                    let db_path = database_path(&app_dir);
                    let db_url = format!("sqlite:{}?mode=rwc", db_path.display());
                    let connection = initialize(&db_url).await?;
                    migration::run(&connection).await?;

                    Ok::<_, anyhow::Error>(Storage::new(connection))
                })
                .expect("failed to initialize database");
                app.manage(db_state);
                app.manage(SidecarState::new());
                app.manage(GooseServeState::new());
                app.manage(GooseAcpHub::new());
                app.manage(TerminalHub::new());
                goose_tls::install_crypto_provider();
                app.manage(ThroughState::new("overlay"));
                app.manage(OverlayPending::default());
                app.manage(OverlayHealth::default());
                app.manage(CapturePending::default());
                app.manage(NavigationState::new());
                through::spawn_worker(app.handle().clone());
                reminder::spawn_worker(app.handle().clone());
                tray::setup(app)?;
                log_retention::prune_stale_logs(app.handle());
                autostart::reconcile(app.handle());

                #[cfg(desktop)]
                {
                    // 不阻塞 setup：后台等待就绪，仅在真正失败时发 corex://not-ready / goose://not-ready
                    #[cfg(windows)]
                    sidecar::spawn_and_watch(app.handle(), Duration::from_secs(20));
                    goose_serve::spawn_and_watch(app.handle(), Duration::from_secs(30));
                }

                Ok(())
            })
            .on_window_event(|window, event| {
                // 浏览窗口销毁时清掉它名下的页面 / 浮层引用：label 会被复用，
                // 残留句柄会让下一扇同编号窗口拿到已销毁的页面。
                if let tauri::WindowEvent::Destroyed = event
                    && crate::navigation::command::is_browser(window.label())
                {
                    crate::navigation::command::prune(window.app_handle(), window.label());
                }
                if window.label() == "main"
                    && let tauri::WindowEvent::CloseRequested { api, .. } = event
                {
                    api.prevent_close();
                    let _ = window.hide();

                    let app = window.app_handle();
                    if let Some(state) = app.try_state::<crate::ui::tray::TrayState>()
                        && !state
                            .notified
                            .swap(true, std::sync::atomic::Ordering::Relaxed)
                    {
                        #[cfg(desktop)]
                        {
                            use tauri_plugin_notification::NotificationExt;
                            let _ = app
                                .notification()
                                .builder()
                                .title("i thinking")
                                .body("应用已最小化到系统托盘，点击托盘图标可重新显示")
                                .show();
                        }
                    }
                }
            })
            .invoke_handler(handlers::invoke_handler())
            .build(generate_context!())
            .expect("error while building application")
            .run(|app, event| {
                if matches!(event, RunEvent::Exit) {
                    goose_serve::shutdown(app);
                    sidecar::shutdown(app);
                    crate::utils::terminal::shutdown(app);
                }
            });
    }
}
