use std::time::Duration;

use cogito_database::{Storage, database_path, initialize, migration};
use tauri::{Manager, RunEvent, generate_context};

use crate::{
    app::{handlers, plugins},
    autostart,
    capture::{CaptureHandshake, CapturePending},
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
                let (db_state, bridge_state) = tauri::async_runtime::block_on(async move {
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

                    let storage = Storage::new(connection);
                    // 本地工具桥：`cogito-mcp` 只经它读写，app 始终是唯一写者。
                    let bridge = crate::bridge::start(storage.clone()).await?;
                    Ok::<_, anyhow::Error>((storage, bridge))
                })
                .expect("failed to initialize database");
                app.manage(db_state);
                app.manage(bridge_state);
                app.manage(SidecarState::new());
                app.manage(GooseServeState::new());
                app.manage(GooseAcpHub::new());
                app.manage(TerminalHub::new());
                goose_tls::install_crypto_provider();
                app.manage(ThroughState::new("overlay"));
                app.manage(OverlayPending::default());
                app.manage(OverlayHealth::default());
                app.manage(CapturePending::default());
                app.manage(CaptureHandshake::default());
                // 浮层窗口常驻映射（hide/show 会让 WebView2 挂起合成，下次首帧要等一次点击）：
                // 启动即铺满整屏（含任务栏）+ 置顶 + 穿透，避免透明窗挡住桌面
                if app
                    .get_webview_window(crate::overlay::command::OVERLAY_LABEL)
                    .is_some()
                {
                    if let Err(error) = crate::overlay::command::apply_bounds(app.handle()) {
                        tracing::warn!("overlay 初始化 bounds 失败: {error}");
                    }
                    if let Some(overlay) =
                        app.get_webview_window(crate::overlay::command::OVERLAY_LABEL)
                    {
                        let _ = overlay.set_ignore_cursor_events(true);
                    }
                } else {
                    // config 窗口可能晚于 setup 创建：稍后再校准一次
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(1_200)).await;
                        if let Err(error) = crate::overlay::command::apply_bounds(&handle) {
                            tracing::warn!("overlay 延迟 bounds 失败: {error}");
                        }
                    });
                }
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
                                .title("cogito")
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
