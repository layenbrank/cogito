use super::common::{
    EmptyEnvelope, Exception, SsoConnectionEnvelope, SsoConnectionListEnvelope, SsoLoginEnvelope,
};
use crate::services::sso::schema::{SsoConnectionUpdateP, SsoConnectionWriteP};

#[utoipa::path(
    get,
    path = "/api/v1/sso/connections",
    tag = "SSO",
    operation_id = "sso.connections",
    summary = "SSO 连接列表",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = SsoConnectionListEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn connections_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/sso/connections",
    tag = "SSO",
    operation_id = "sso.connectionWrite",
    summary = "创建 SSO 连接",
    security(("bearer_auth" = [])),
    request_body(content = SsoConnectionWriteP, description = "连接信息"),
    responses(
        (status = 200, description = "成功", body = SsoConnectionEnvelope),
        (status = "default", description = "业务异常（参数错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn connection_write_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/sso/connections/{id}",
    tag = "SSO",
    operation_id = "sso.connectionUpdate",
    summary = "更新 SSO 连接",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "连接 ID")),
    request_body(content = SsoConnectionUpdateP, description = "连接信息"),
    responses(
        (status = 200, description = "成功", body = SsoConnectionEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn connection_update_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/sso/connections/{id}",
    tag = "SSO",
    operation_id = "sso.connectionRemove",
    summary = "删除 SSO 连接",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "连接 ID")),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn connection_remove_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/sso/{id}/authorize",
    tag = "SSO",
    operation_id = "sso.authorize",
    summary = "发起 OIDC 授权（302 到 IdP）",
    params(("id" = String, Path, description = "连接 ID")),
    responses(
        (status = 302, description = "重定向到身份提供商"),
        (status = "default", description = "业务异常（连接不存在）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn authorize_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/sso/{id}/callback",
    tag = "SSO",
    operation_id = "sso.callback",
    summary = "OIDC 回调（换取 token）",
    params(
        ("id" = String, Path, description = "连接 ID"),
        ("code" = String, Query, description = "授权码"),
        ("state" = String, Query, description = "state"),
    ),
    responses(
        (status = 200, description = "成功（返回 JWT）", body = SsoLoginEnvelope),
        (status = "default", description = "业务异常（登录失败）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn callback_doc() {}
