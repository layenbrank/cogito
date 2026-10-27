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

    // 定时任务是独立的 tick：与事件发布共用一个进程，但互不阻塞。
    // 起不了编排也照跑 —— 每个到期任务各自落 `lastError`，比让整个 worker 起不来清楚。
    spawn_scheduler(storage.clone(), configure.clone());

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

/// 定时任务循环：认领到期任务 → 起 agent 任务 → 回写状态。
///
/// 间隔取 `events.poll_interval_ms`（同一份部署配置里的「后台轮询节奏」）；
/// 有活时立刻再跑一轮，没活才按间隔等 —— tick 本身只是几条 SQL。
///
/// **必须跑在独立的 current-thread runtime + `LocalSet` 上**：编排客户端（duroxide）
/// 内部用 `spawn_local`，多线程 runtime 的 worker 线程没有 LocalSet，会直接 panic
/// （实测：`spawn_local called from outside of a task::LocalSet`）。api 侧没事是因为
/// `#[actix_web::main]` 本身就是单线程 runtime + LocalSet。
fn spawn_scheduler(storage: Storage, configure: Configure) {
    let spawned = std::thread::Builder::new()
        .name("scheduler".to_owned())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    tracing::error!(error = %error, "创建调度 runtime 失败");
                    return;
                }
            };
            let local = tokio::task::LocalSet::new();
            local.block_on(&runtime, scheduler_loop(storage, configure));
        });

    if let Err(error) = spawned {
        tracing::error!(error = %error, "启动调度线程失败");
    }
}

async fn scheduler_loop(storage: Storage, configure: Configure) {
    let interval = std::time::Duration::from_millis(configure.events.poll_interval_ms.max(1_000));
    let durable = cogito::clients::durable::connect(&configure).await;
    if durable.is_none() {
        tracing::warn!("编排库未接通：定时任务会以失败状态记录（原因写进 lastError）");
    }
    loop {
        let now = chrono::Utc::now().timestamp_millis();
        let count =
            cogito::worker::scheduler::tick(&storage, &configure, durable.as_ref(), now).await;
        let wait = if count > 0 {
            std::time::Duration::from_secs(1)
        } else {
            interval
        };
        tokio::time::sleep(wait).await;
    }
}
