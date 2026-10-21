use std::sync::Arc;

use actix_web::HttpServer;
use durable::{Client, DurableSettings, Store};
use cogito::{
    bootstrap::BootstrapOptions, bootstrap_app, clients::ai_worker::AiWorkerClient,
    clients::redis::RedisPool, configures::configure::Configure,
    databases::database::Storage, middlewares::rate_limit::build_auth_governor, utils,
};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let configure = Configure::load().expect("Failed to load configuration");

    let telemetry =
        utils::telemetry::init(&configure, "api").expect("Failed to initialize telemetry");
    let log_guard =
        utils::logger::init(&configure.logging, telemetry).expect("Failed to initialize logger");

    tracing::info!(
        profile = %configure.profile,
        config_dir = %configure.config_dir.display(),
        host = %configure.host(),
        port = configure.port(),
        encryption = ?configure.encryption(),
        redis_url = %configure.redis_url(),
        "configuration loaded"
    );

    let storage = Storage::new(configure.database_uri())
        .await
        .expect("Failed to connect to database");

    cogito::bootstrap::ensure_bootstrap_admin(&storage, &configure)
        .await
        .expect("Failed to ensure bootstrap admin");

    let redis = RedisPool::new(configure.redis_url(), configure.redis_pool_size())
        .await
        .expect("Failed to connect to Redis");

    let durable = connect_durable(&configure).await;
    let ai_worker = connect_ai_worker(&configure);

    let host = configure.server.host.clone();
    let port = configure.server.port;
    let enable_swagger = configure.app.swagger;
    let store = Arc::new(storage);
    let config = Arc::new(configure);
    let redis = Arc::new(redis);

    let bootstrap = BootstrapOptions::development(enable_swagger);
    let auth_governor = build_auth_governor(config.as_ref());

    tracing::info!(host = %host, port, enable_swagger, "service starting");
    #[cfg(feature = "openapi")]
    if enable_swagger {
        tracing::info!("Swagger UI: http://{host}:{port}/swagger-ui/");
    }
    #[cfg(not(feature = "openapi"))]
    if enable_swagger {
        tracing::warn!("Swagger 未编译，请使用: cargo run --bin cogito --features openapi");
    }

    #[cfg(feature = "openapi")]
    if enable_swagger {
        use cogito::bootstrap::swagger;
        use cogito::oas::OpenDoc;
        use utoipa::OpenApi;
        use utoipa_swagger_ui::SwaggerUi;

        let result = HttpServer::new(move || {
            bootstrap_app!(
                store.clone(),
                config.clone(),
                redis.clone(),
                durable.clone(),
                ai_worker.clone(),
                bootstrap.clone(),
                auth_governor.clone()
            )
            .service(swagger::redirect_to_ui)
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}")
                    .url("/api-docs/openapi.json", OpenDoc::openapi()),
            )
        })
        .bind((host, port))?
        .run()
        .await;

        log_guard.shutdown();
        return result;
    }

    let result = HttpServer::new(move || {
        bootstrap_app!(
            store.clone(),
            config.clone(),
            redis.clone(),
            durable.clone(),
            ai_worker.clone(),
            bootstrap.clone(),
            auth_governor.clone()
        )
    })
    .bind((host, port))?
    .run()
    .await;

    log_guard.shutdown();
    result
}

/// 连编排库（durable 的独立 schema）。
///
/// **连不上不阻塞启动**：其余接口与编排无关，让整个 api 起不来只会把一个「agent 不可用」
/// 放大成「全站不可用」。连不上时返回 `None`，agent 两个接口分别回 503 与台账原样。
///
/// 迁移策略沿用配置里的 `auto_migrate`（默认开），**不用 `VerifyOnly`**：api 是持有业务库
/// DDL 权限的应用后端，`duroxide-pg` 的 verify 只在不做 DDL 的前提下才成立，schema 还没建时
/// 它会直接硬失败。两个进程同时应用迁移也是安全的——provider 用 schema 名哈希出的
/// advisory lock 把迁移串行化了。
async fn connect_durable(config: &Configure) -> Option<Arc<Client>> {
    let url = match config.require_durable_settings() {
        Ok(url) => url,
        Err(error) => {
            tracing::warn!(error = %error, "编排库未配置：agent 任务接口不可用");
            return None;
        }
    };

    let settings = DurableSettings::new(
        url,
        config.durable.schema.clone(),
        config.durable.auto_migrate,
    );

    match Store::connect(&settings).await {
        Ok(store) => Some(Arc::new(store.client())),
        Err(error) => {
            tracing::error!(
                error = %error,
                schema = %config.durable.schema,
                "编排库连接失败：agent 任务接口不可用"
            );
            None
        }
    }
}

/// 连 ai-worker（Python 计算车间）。
///
/// **连不上不阻塞启动**：ai-worker 只服务 MCP 的工具调用，让整个 api 起不来只会把一个
/// 「工具暂不可用」放大成「全站不可用」。连不上时返回 `None`，MCP `tools/call` 回一条
/// 「ai-worker 暂不可用」的失败结果（不是故障）。
fn connect_ai_worker(config: &Configure) -> Option<Arc<AiWorkerClient>> {
    let base_url = config.ai_worker.base_url.trim();
    if base_url.is_empty() {
        tracing::warn!("ai_worker.base_url 未配置：MCP 工具调用不可用");
        return None;
    }

    match AiWorkerClient::from_parts(
        base_url,
        &config.ai_worker.token,
        config.ai_worker.timeout_ms,
        config.ai_worker.use_system_proxy,
    ) {
        Ok(client) => Some(Arc::new(client)),
        Err(error) => {
            tracing::error!(error = %error, "ai-worker 客户端构建失败：MCP 工具调用不可用");
            None
        }
    }
}
