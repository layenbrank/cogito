use cogito::{
    configures::configure::Configure,
    databases::database::Storage,
    utils,
    worker::{dispatcher::WorkerDispatcher, runner},
};

/// 事件发布 worker：把 outbox 里已提交的事件投递给下游。
///
/// 不监听端口，因此不需要 Redis；只需要数据库和一个下游端点。
/// 停机信号（Ctrl-C / 编排器 SIGTERM）只在一轮与下一轮之间生效：正在投递的那一轮走完，
/// 剩下的留在 outbox 里等重启。
#[tokio::main]
async fn main() {
    let configure = Configure::load().expect("Failed to load configuration");
    configure
        .require_events_endpoint()
        .expect("events 配置不完整（生产环境必须提供 endpoint 与 token）");

    let telemetry =
        utils::telemetry::init(&configure, "worker").expect("Failed to initialize telemetry");
    let log_guard =
        utils::logger::init(&configure.logging, telemetry).expect("Failed to initialize logger");

    tracing::info!(
        profile = %configure.profile,
        config_dir = %configure.config_dir.display(),
        poll_interval_ms = configure.events.poll_interval_ms,
        batch_size = configure.events.batch_size,
        endpoint = %configure.events.endpoint,
        "worker starting"
    );

    let storage = Storage::new(configure.database_uri())
        .await
        .expect("Failed to connect to database");
    let dispatcher =
        WorkerDispatcher::from_configure(&configure).expect("Failed to build dispatcher");
    let options = runner::LoopOptions::from_configure(&configure);

    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let signal = tokio::spawn(async move {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error = %error, "无法监听停机信号");
            return;
        }
        tracing::info!("收到停机信号：本轮结束后退出");
        let _ = shutdown_tx.send(true);
    });

    let result = runner::run(storage, dispatcher, options, shutdown_rx).await;
    signal.abort();

    if let Err(error) = result {
        tracing::error!(error = %error, "worker 退出");
        log_guard.shutdown();
        std::process::exit(1);
    }

    log_guard.shutdown();
}
