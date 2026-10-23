use std::sync::Arc;
use std::time::Duration;

use actix_web::{HttpResponse, Responder, ResponseError, get, web};

use crate::clients::compute::ComputeClient;
use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::interceptors::envelope::Envelope;
use crate::oas::common::{DependencyCheck, Health, Liveness, Readiness};
use crate::utils::code;

/// 探活超时：探针要快速给结论，不能沿用长任务默认的 30s 调用超时
const COMPUTE_PROBE_TIMEOUT_MS: u64 = 2_000;

/// Redis 探针上限：fred 默认 `fail_fast = false`，断连时命令会排队等重连而不报错，
/// 缺少超时会让 `/api/ready` 挂住不返回（重建 redis 容器断开既有连接即可复现）。
const REDIS_PROBE_TIMEOUT_MS: u64 = 2_000;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(health_check);
    cfg.service(liveness);
    cfg.service(readiness);
}

/// 健康检查（含 Redis）
#[get("/api/health")]
async fn health_check(
    db: web::Data<Arc<Storage>>,
    redis: web::Data<Arc<RedisPool>>,
) -> impl Responder {
    let postgres = postgres_status(db.get_ref().as_ref()).await;
    let redis = redis_status(redis.get_ref().as_ref()).await;

    // 既有口径：依赖异常不改变 HTTP 状态码，只用 data.status 表达
    let all_up = postgres.status == "up" && redis.status == "up";
    let health = Health {
        status: if all_up {
            "healthy".into()
        } else {
            "degraded".into()
        },
        version: env!("CARGO_PKG_VERSION").into(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        uptime: "N/A".into(),
        postgres: postgres.status,
        redis: redis.status,
    };

    let msg = if all_up {
        "服务运行正常"
    } else {
        "服务部分依赖异常"
    };

    Envelope::success(health, msg)
        .transform()
        .unwrap_or_else(|_| Exception::internal_error("健康检查响应序列化失败").error_response())
}

/// 存活探针：不碰任何依赖，因此无条件 200——依赖故障该由负载均衡/编排策略处理，不该靠重启解决
#[get("/api/live")]
async fn liveness() -> impl Responder {
    let payload = Liveness {
        status: "alive".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        timestamp: chrono::Utc::now().timestamp_millis(),
    };

    Envelope::success(payload, "服务进程存活")
        .transform()
        .unwrap_or_else(|_| Exception::internal_error("存活探针响应序列化失败").error_response())
}

/// 就绪探针：先探依赖，再按「关键依赖」判定能否接流量
#[get("/api/ready")]
async fn readiness(
    db: web::Data<Arc<Storage>>,
    redis: web::Data<Arc<RedisPool>>,
    config: web::Data<Arc<Configure>>,
) -> HttpResponse {
    let checks = vec![
        postgres_status(db.get_ref().as_ref()).await,
        redis_status(redis.get_ref().as_ref()).await,
        compute_status(config.get_ref().as_ref()).await,
    ];

    readiness_response(checks)
}

/// 就绪结论 → 响应：任一**关键**依赖故障 ⇒ 503（`code=100002`）；仅非关键依赖故障 ⇒ 200 + `degraded`。
/// 纯函数，两条分支不必依赖真实基础设施就能验证。
fn readiness_response(checks: Vec<DependencyCheck>) -> HttpResponse {
    let failed: Vec<&str> = checks
        .iter()
        .filter(|check| check.critical && check.status != "up")
        .map(|check| check.name.as_str())
        .collect();

    if !failed.is_empty() {
        return Exception::custom(
            code::system::SERVICE_UNAVAILABLE,
            format!("依赖未就绪：{}", failed.join("、")),
        )
        .with_details(serde_json::json!({ "checks": checks }))
        .error_response();
    }

    let degraded = checks.iter().any(|check| check.status != "up");
    let snapshot = Readiness {
        status: if degraded { "degraded" } else { "ready" }.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        timestamp: chrono::Utc::now().timestamp_millis(),
        checks,
    };
    let msg = if degraded {
        "关键依赖正常，存在非关键依赖异常"
    } else {
        "依赖全部就绪"
    };

    Envelope::success(snapshot, msg)
        .transform()
        .unwrap_or_else(|_| Exception::internal_error("就绪探针响应序列化失败").error_response())
}

/// 组装一条探测结果（`critical` 的判定理由见 `src/oas/system.rs::ready_doc`）
fn dependency(name: &str, critical: bool, status: &str, detail: Option<String>) -> DependencyCheck {
    DependencyCheck {
        name: name.into(),
        critical,
        status: status.into(),
        detail,
    }
}

/// PostgreSQL：本文件唯一的未作用域数据库访问（R9 门禁按文件计数，只登记这一处）
async fn postgres_status(db: &Storage) -> DependencyCheck {
    match db.raw().ping().await {
        Ok(()) => dependency("postgres", true, "up", None),
        Err(err) => dependency("postgres", true, "down", Some(err.to_string())),
    }
}

/// Redis：会话、限流、幂等都在它上面，缺了鉴权入口直接不可用 ⇒ 关键依赖
async fn redis_status(redis: &RedisPool) -> DependencyCheck {
    let timeout = Duration::from_millis(REDIS_PROBE_TIMEOUT_MS);
    match tokio::time::timeout(timeout, redis.ping()).await {
        Ok(Ok(())) => dependency("redis", true, "up", None),
        Ok(Err(err)) => dependency("redis", true, "down", Some(err.to_string())),
        Err(_) => dependency(
            "redis",
            true,
            "down",
            Some(format!("探针超时（{REDIS_PROBE_TIMEOUT_MS}ms）")),
        ),
    }
}

/// compute（Python 计算车间）：**可选**依赖——只影响 RAG 长任务，且 api 二进制默认不配置它，
/// 因此未配置记为 `unconfigured`（不算故障），配置了就真探一次它的 health 接口。
/// 探针低频（秒级一次），这里每次现建客户端，不做缓存。
async fn compute_status(config: &Configure) -> DependencyCheck {
    let base_url = config.compute.base_url.trim();
    if base_url.is_empty() {
        return dependency(
            "compute",
            false,
            "unconfigured",
            Some("未配置 compute.base_url".into()),
        );
    }

    let client = match ComputeClient::from_parts(
        base_url,
        &config.compute.token,
        COMPUTE_PROBE_TIMEOUT_MS,
        config.compute.use_system_proxy,
    ) {
        Ok(client) => client,
        Err(err) => return dependency("compute", false, "down", Some(err.to_string())),
    };

    match client.health().await {
        Ok(health) => {
            let capabilities = if health.capabilities.is_empty() {
                String::new()
            } else {
                format!("，能力 {}", health.capabilities.join("/"))
            };

            dependency(
                "compute",
                false,
                "up",
                Some(format!(
                    "v{}（{}）{capabilities}",
                    health.version, health.status
                )),
            )
        }
        Err(err) => dependency("compute", false, "down", Some(err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, http::StatusCode, test};
    use sea_orm::{ConnectOptions, Database};

    fn check(name: &str, critical: bool, status: &str) -> DependencyCheck {
        dependency(name, critical, status, None)
    }

    async fn body_of(response: HttpResponse) -> serde_json::Value {
        let bytes = actix_web::body::to_bytes(response.into_body())
            .await
            .expect("读取响应体");
        serde_json::from_slice(&bytes).expect("响应体应为 JSON")
    }

    #[actix_web::test]
    async fn liveness_answers_without_any_dependency() {
        let app = test::init_service(App::new().configure(|cfg| {
            crate::bootstrap::BootstrapModule::configure(
                cfg,
                &crate::bootstrap::BootstrapOptions::development(false),
            )
        }))
        .await;

        let response =
            test::call_service(&app, test::TestRequest::get().uri("/api/live").to_request()).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body: serde_json::Value = test::read_body_json(response).await;
        assert_eq!(body["code"], 200000);
        assert_eq!(body["success"], true);
        assert_eq!(body["data"]["status"], "alive");
        assert_eq!(body["data"]["version"], env!("CARGO_PKG_VERSION"));
    }

    #[actix_web::test]
    async fn non_critical_failure_keeps_serving_traffic() {
        let response = readiness_response(vec![
            check("postgres", true, "up"),
            check("redis", true, "up"),
            check("compute", false, "unconfigured"),
        ]);

        assert_eq!(response.status(), StatusCode::OK);
        let body = body_of(response).await;
        assert_eq!(body["code"], 200000);
        assert_eq!(body["data"]["status"], "degraded");
        assert_eq!(body["data"]["checks"][2]["name"], "compute");
    }

    #[actix_web::test]
    async fn critical_failure_stops_traffic_and_names_the_dependency() {
        let response = readiness_response(vec![
            check("postgres", true, "down"),
            check("redis", true, "up"),
        ]);

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = body_of(response).await;
        assert_eq!(body["code"], code::system::SERVICE_UNAVAILABLE);
        assert_eq!(body["success"], false);
        let msg = body["msg"].as_str().expect("msg 为字符串");
        assert!(msg.contains("postgres"), "msg 应点名故障依赖，实际 {msg}");
    }

    #[actix_web::test]
    async fn all_dependencies_up_is_ready() {
        let response = readiness_response(vec![
            check("postgres", true, "up"),
            check("redis", true, "up"),
            check("compute", false, "up"),
        ]);

        assert_eq!(response.status(), StatusCode::OK);
        let body = body_of(response).await;
        assert_eq!(body["data"]["status"], "ready");
    }

    #[actix_web::test]
    async fn postgres_probe_maps_unreachable_database_to_down() {
        // 懒连接：不在构造期拨号，只在 ping 时才暴露故障
        let mut options =
            ConnectOptions::new("postgres://probe:probe@127.0.0.1:1/probe".to_owned());
        options.connect_lazy(true).sqlx_logging(false);
        let db = Database::connect(options)
            .await
            .expect("懒连接不要求目标可达");
        let storage = Storage::from_parts(db, "probe".to_string());

        let probe = postgres_status(&storage).await;
        assert_eq!(probe.status, "down");
        assert!(probe.critical, "PostgreSQL 是关键依赖");
        assert!(probe.detail.is_some(), "故障必须带原因");
    }

    #[actix_web::test]
    async fn compute_probe_distinguishes_unconfigured_from_down() {
        let mut config = Configure::default();

        let unconfigured = compute_status(&config).await;
        assert_eq!(unconfigured.status, "unconfigured");
        assert!(!unconfigured.critical);

        // 必然没人监听的端口：连接被拒 ⇒ down（而不是 unconfigured）
        config.compute.base_url = "http://127.0.0.1:1".into();
        let down = compute_status(&config).await;
        assert_eq!(down.status, "down");
    }
}
