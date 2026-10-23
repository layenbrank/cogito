use super::common::{ApplicationEnvelope, Exception};

/// 获取应用配置（Mock）
#[utoipa::path(
    get,
    path = "/api/v1/application/toRead",
    tag = "Application",
    operation_id = "application.toRead",
    summary = "读取应用配置",
    description = "返回 mock 应用配置，无需鉴权。",
    responses(
        (status = 200, description = "获取成功（code=200000）", body = ApplicationEnvelope),
        (status = "default", description = "业务异常（服务错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_doc() {}
