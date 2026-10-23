use crate::oas::common::{Exception, HealthEnvelope, LivenessEnvelope, ReadinessEnvelope};

/// 服务健康检查
#[utoipa::path(
    get,
    path = "/api/health",
    tag = "System",
    operation_id = "system.health",
    summary = "健康检查",
    description = "检查服务与 PostgreSQL / Redis 依赖状态，无需鉴权。依赖异常不改变 HTTP 状态码（200），通过 data.status=degraded 与各依赖项 up/down 表达。",
    responses(
        (status = 200, description = "服务正常（code=200000）", body = HealthEnvelope),
        (status = "default", description = "业务异常（服务异常）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn health_doc() {}

/// 存活探针：进程还在跑
#[utoipa::path(
    get,
    path = "/api/live",
    tag = "System",
    operation_id = "system.live",
    summary = "存活探针（liveness）",
    description = "只证明进程存活且能响应 HTTP，**不检查任何依赖**：依赖故障不该让编排器重启实例。恒定 200（code=200000）。",
    responses(
        (status = 200, description = "进程存活（code=200000）", body = LivenessEnvelope),
        (status = "default", description = "业务异常（服务异常）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn live_doc() {}

/// 就绪探针：能否接流量
#[utoipa::path(
    get,
    path = "/api/ready",
    tag = "System",
    operation_id = "system.ready",
    summary = "就绪探针（readiness）",
    description = "检查各依赖后回答「能否接流量」。data.status=ready 表示关键依赖全通（个别非关键依赖异常时为 degraded，仍返回 200 并照常接流量）；任一关键依赖故障则返回 503（code=100002，system.SERVICE_UNAVAILABLE，msg 列出故障项）。各依赖的探测结果与是否关键见 data.checks[].critical；需要完整依赖快照（恒 200）请用 /api/health。",
    responses(
        (status = 200, description = "就绪（code=200000）：data.status=ready|degraded，data.checks 为各依赖快照", body = ReadinessEnvelope),
        (status = "default", description = "业务异常（未就绪 / 服务异常）：关键依赖故障返回 503（code=100002），非生产环境 details 附完整依赖快照；HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn ready_doc() {}
