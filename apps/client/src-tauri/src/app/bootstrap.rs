use std::time::Duration;

use cogito_database::{Storage, database_path, initialize, migration};
use tauri::{Manager, RunEvent, generate_context};

use crate::{
    app::{handlers, plugins},
    automation, autostart,
    browser::state::BrowserState,
    capture::{CaptureHandshake, CapturePending},
    overlay::{OverlayHealth, OverlayPending},
    reminder,
    through::{self, ThroughState},
    ui::tray,
    utils::{
        agent_cache,
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
                // 双实例：隔离 dev 实例（identifier `com.cogito.client.dev`）与已安装的
                // 正式包并存，管道 / 端口 / 窗口标题都要跟着换（见 `utils::instance`）。
                use crate::utils::instance;
                instance::init(app.config().identifier.as_str());
                if instance::isolated()
                    && let Some(window) = app.get_webview_window("main")
                {
                    let _ = window.set_title(&instance::label("cogito"));
                }
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
                    // 知识库根：`<app_local_data_dir>/knowledge/<slug>/`；不自动建「默认库」，
                    // 由用户选场景模板新建或导入示例库。
                    std::fs::create_dir_all(app_dir.join("knowledge"))
                        .map_err(|error| anyhow::anyhow!("创建知识库根目录失败: {error}"))?;
                    // 本地工具桥：`cogito-mcp` 只经它读写，app 始终是唯一写者。
                    // 传 AppHandle 是因为 `app_browser_*` 要访问宿主 webview。
                    let bridge =
                        crate::bridge::start(storage.clone(), handle_for_db.clone()).await?;
                    crate::bridge::start_clip_server(handle_for_db.clone(), storage.clone()).await;
                    Ok::<_, anyhow::Error>((storage, bridge))
                })
                .expect("failed to initialize database");
                app.manage(db_state);
                // 工具审计（S6）：启动时裁掉 7 天前的行。审计是旁路，失败只 warn，
                // 绝不阻塞启动 —— 表被写坏也不该让人打不开 app。
                {
                    let audit_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        use tauri::Manager;
                        let storage = audit_handle.state::<Storage>().inner().clone();
                        let now = cogito_core::tools::audit::now_ms();
                        match cogito_core::tools::audit::prune(storage.connection(), now).await {
                            Ok(0) => {}
                            Ok(dropped) => tracing::info!(dropped, "工具审计：清理过期记录"),
                            Err(error) => tracing::warn!("工具审计：清理过期记录失败：{error}"),
                        }
                    });
                }
                app.manage(bridge_state);
                app.manage(SidecarState::new());
                app.manage(GooseServeState::new());
                app.manage(GooseAcpHub::new());
                app.manage(TerminalHub::new());
                // 闲置回收：agent 会话 30 分钟无输出且没有在跑的 run 就关掉
                crate::utils::terminal::start_idle_reaper(app.handle().clone());
                app.manage(BrowserState::default());
                // 授权集（S1/1A）：capabilities 的静态 scope 只是下限，运行期真正放行哪些目录/文件由它决定。
                // 失败不阻塞启动：只影响图库/工作区的越界读取，各自有可读错误。
                // `--safe-mode` / `COGITO_SAFE_MODE=1` 是逃生门：收口把用户收挂时退回整盘放行。
                if crate::security::grants::safe_mode_enabled() {
                    crate::security::grants::apply_safe_mode(&app.handle());
                } else {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = crate::security::grants::rebuild(&handle).await {
                            tracing::warn!("授权集重建失败：{error}");
                        }
                    });
                }
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
                crate::overlay::watchdog::spawn(app.handle().clone());
                #[cfg(debug_assertions)]
                crate::overlay::watchdog::spawn_dev_stall(app.handle().clone());

                // 截屏态演练（仅 debug）：COGITO_DEV_SCREENSHOT_MS=<毫秒>
                #[cfg(debug_assertions)]
                crate::overlay::command::spawn_dev_screenshot(app.handle().clone());

                // 截屏全链路演练（仅 debug）：COGITO_DEV_CAPTURE_MS / COGITO_DEV_CAPTURE_REPEAT
                #[cfg(debug_assertions)]
                crate::capture::command::spawn_dev_capture(app.handle().clone());

                // 缺可选工具文案演练（仅 debug）：COGITO_DEV_TOOL_PROBE=1
                #[cfg(debug_assertions)]
                crate::media::command::spawn_dev_tool_probe(app.handle().clone());
                reminder::spawn_worker(app.handle().clone());
                automation::spawn_worker(app.handle().clone());
                tray::setup(app)?;
                // 出站代理：读 settings.json 的 proxy 段写入进程 env（reqwest / plugin-http）
                crate::system::proxy::bootstrap_from_store(app.handle());
                // 剪藏本机接收：bridge::start_clip_server（127.0.0.1:19828 → knowledge://clip）
                // 禁 WebView 原生 Ctrl/Cmd+F 查找条（Windows 走 WebView2 设置；其它平台靠前端拦）
                crate::ui::native_find::disable_on_app(app.handle());
                // 构建指纹：先记一条日志，之后「截图超时 / 拦截不命中」这类问题能一眼判断
                // 是不是旧二进制造成的（链接时间早于最近一次构建 = 该重启了）。
                let build = crate::utils::build_info::build_info();
                tracing::info!(
                    identifier = %app.config().identifier,
                    version = %build.version,
                    profile = %build.profile,
                    exe = %build.exe,
                    exe_modified_ms = build.exe_modified_ms,
                    pid = build.pid,
                    "宿主构建指纹"
                );
                log_retention::prune_stale_logs(app.handle());
                // Agent 缓存：清掉超过保留期的会话子目录（目录契约见 utils::agent_cache）
                agent_cache::prune_stale_caches(agent_cache::retention_days());
                // 会话标记 + 上次异常退出：崩溃/被杀的现场要能被下次启动认出来
                // `begin_session()` 内部保证「先读旧标记再写 running」的顺序。
                let previous_session = crate::utils::diagnostics::begin_session();
                match previous_session {
                    Some(session)
                        if crate::utils::diagnostics::previous_session_crashed(Some(&session)) =>
                    {
                        tracing::warn!(
                            "上次会话未正常退出（pid={}, startedAt={}），待上报崩溃现场 {} 份",
                            session.pid,
                            session.started_at,
                            crate::utils::diagnostics::read_pending_crashes().len()
                        );
                    }
                    _ => tracing::info!("会话开始（pid={}）", std::process::id()),
                }
                autostart::reconcile(app.handle());

                #[cfg(desktop)]
                {
                    // 不阻塞 setup：后台等待就绪，仅在真正失败时发 corex://not-ready / goose://not-ready
                    // 演练：COGITO_DEV_NO_SIDECAR=1 时不拉起 sidecar（仅 debug 构建有这个开关），
                    // 避免与正在运行的正式实例抢端口。
                    let skip_sidecar = cfg!(debug_assertions)
                        && std::env::var_os("COGITO_DEV_NO_SIDECAR").is_some();
                    if !skip_sidecar {
                        #[cfg(windows)]
                        sidecar::spawn_and_watch(app.handle(), Duration::from_secs(20));
                        goose_serve::spawn_and_watch(app.handle(), Duration::from_secs(30));
                    }
                }

                // 崩溃演练入口（仅 debug 构建有）：COGITO_DEV_PANIC=boom|abort
                #[cfg(debug_assertions)]
                crate::utils::diagnostics::spawn_dev_panic_probe();

                // 正常退出演练（仅 debug）：COGITO_DEV_EXIT_MS=8000 → 到点走 app.exit(0)，
                // 用来验证 RunEvent::Exit 上的 mark_clean_exit + sidecar 回收。
                #[cfg(debug_assertions)]
                if let Some(ms) = std::env::var("COGITO_DEV_EXIT_MS")
                    .ok()
                    .and_then(|raw| raw.trim().parse::<u64>().ok())
                {
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(ms)).await;
                        tracing::info!("演练：app.exit(0)（走 RunEvent::Exit）");
                        handle.exit(0);
                    });
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
                    // 先落盘再拆子进程：即便后面某步 panic，也留下了「正常退出」的结论
                    crate::utils::diagnostics::mark_clean_exit();
                    tracing::info!("应用退出，开始回收 sidecar");
                    goose_serve::shutdown(app);
                    sidecar::shutdown(app);
                    crate::utils::terminal::shutdown(app);
                }
            });
    }
}
