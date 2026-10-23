use super::common::{Exception, UserEnvelope, UserListEnvelope};
use crate::services::user::schema::{UpdateP, WriteP};

/// 获取用户列表
#[utoipa::path(
    get,
    path = "/api/v1/users",
    tag = "User",
    operation_id = "user.toRead",
    summary = "获取用户列表",
    description = "后台管理员接口，返回全部用户，需要 JWT 鉴权。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "获取成功（code=200000）", body = UserListEnvelope),
        (status = "default", description = "业务异常（未登录或权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_doc() {}

/// 创建用户
#[utoipa::path(
    post,
    path = "/api/v1/users",
    tag = "User",
    operation_id = "user.toWrite",
    summary = "创建用户",
    description = "后台管理员接口，需要 JWT 鉴权。",
    security(("bearer_auth" = [])),
    request_body(
        content = WriteP,
        description = "新用户账号",
        example = json!({
            "username": "alice",
            "password": "123456",
            "role": "USER"
        })
    ),
    responses(
        (status = 200, description = "创建成功（code=200000）", body = UserEnvelope),
        (status = "default", description = "业务异常（用户名已存在等业务错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toWrite_doc() {}

/// 获取单个用户
#[utoipa::path(
    get,
    path = "/api/v1/users/{id}",
    tag = "User",
    operation_id = "user.toReadById",
    summary = "获取用户详情",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "用户 UUID", example = "3c430c21-0891-43e1-bcd2-1a22eb4a5389")
    ),
    responses(
        (status = 200, description = "获取成功（code=200000）", body = UserEnvelope),
        (status = "default", description = "业务异常（用户不存在（code=500101））：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_by_id_doc() {}

/// 更新用户
#[utoipa::path(
    put,
    path = "/api/v1/users/{id}",
    tag = "User",
    operation_id = "user.toUpdate",
    summary = "更新用户",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "用户 UUID", example = "3c430c21-0891-43e1-bcd2-1a22eb4a5389")
    ),
    request_body(
        content = UpdateP,
        description = "可更新字段（均为可选）",
        example = json!({
            "username": "alice",
            "email": "alice@example.com",
            "phone": "13800138000",
            "gender": "FEMALE",
            "birthday": "1990-01-01",
            "age": 30,
            "role": "USER",
            "status": "ACTIVE"
        })
    ),
    responses(
        (status = 200, description = "更新成功（code=200000）", body = UserEnvelope),
        (status = "default", description = "业务异常（用户不存在或参数错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toUpdate_doc() {}

/// 删除用户
#[utoipa::path(
    delete,
    path = "/api/v1/users/{id}",
    tag = "User",
    operation_id = "user.toRemove",
    summary = "删除用户",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "用户 UUID", example = "3c430c21-0891-43e1-bcd2-1a22eb4a5389")
    ),
    responses(
        (status = 200, description = "删除成功（code=200000）", body = UserEnvelope),
        (status = "default", description = "业务异常（用户不存在）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRemove_doc() {}
