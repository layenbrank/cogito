use std::sync::Arc;

use actix_web::HttpServer;
use durable::Client;
use cogito::{
    bootstrap::BootstrapOptions, bootstrap_app, clients::compute::ComputeClient,
    clients::redis::RedisPool, configures::configure::Configure,
    databases::database::Storage, middlewares::rate_limit::build_auth_governor, utils,
};

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let configure = Configure::load().expect("Failed to load configuration");

    let telemetry =
        utils::telemetry::init(&configure, "service").expect("Failed to initialize telemetry");
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
    let compute = connect_compute(&configure);

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
                compute.clone(),
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
            compute.clone(),
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

async fn connect_durable(config: &Configure) -> Option<Arc<Client>> {
    cogito::clients::durable::connect(config).await
}

/// 连 compute（Python 计算车间）。
///
/// **连不上不阻塞启动**：compute 只服务 MCP 的工具调用，让整个 api 起不来只会把一个
/// 「工具暂不可用」放大成「全站不可用」。连不上时返回 `None`，MCP `tools/call` 回一条
/// 「compute 暂不可用」的失败结果（不是故障）。
fn connect_compute(config: &Configure) -> Option<Arc<ComputeClient>> {
    let base_url = config.compute.base_url.trim();
    if base_url.is_empty() {
        tracing::warn!("compute.base_url 未配置：MCP 工具调用不可用");
        return None;
    }

    match ComputeClient::from_parts(
        base_url,
        &config.compute.token,
        config.compute.timeout_ms,
        config.compute.use_system_proxy,
    ) {
        Ok(client) => Some(Arc::new(client)),
        Err(error) => {
            tracing::error!(error = %error, "compute 客户端构建失败：MCP 工具调用不可用");
            None
        }
    }
}
