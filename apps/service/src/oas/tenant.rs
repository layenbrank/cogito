use super::common::{
    EmptyEnvelope, Exception, MemberEnvelope, MemberListEnvelope, TenantEnvelope,
    TenantListEnvelope,
};
use crate::services::tenant::schema::{MemberUpdateP, MemberWriteP, TenantUpdateP, TenantWriteP};

#[utoipa::path(
    get,
    path = "/api/v1/tenants",
    tag = "Tenant",
    operation_id = "tenant.toList",
    summary = "我所属的租户",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = TenantListEnvelope),
        (status = "default", description = "业务异常（未登录）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toList_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants",
    tag = "Tenant",
    operation_id = "tenant.toWrite",
    summary = "创建租户",
    security(("bearer_auth" = [])),
    request_body(content = TenantWriteP, description = "租户信息"),
    responses(
        (status = 200, description = "成功", body = TenantEnvelope),
        (status = "default", description = "业务异常（参数错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toWrite_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}",
    tag = "Tenant",
    operation_id = "tenant.toReadById",
    summary = "租户详情",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = TenantEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_by_id_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/tenants/{id}",
    tag = "Tenant",
    operation_id = "tenant.toUpdate",
    summary = "更新租户",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    request_body(content = TenantUpdateP, description = "租户信息"),
    responses(
        (status = 200, description = "成功", body = TenantEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toUpdate_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/tenants/{id}",
    tag = "Tenant",
    operation_id = "tenant.toRemove",
    summary = "删除租户",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRemove_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/members",
    tag = "Tenant",
    operation_id = "tenant.members",
    summary = "成员列表",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = MemberListEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn members_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants/{id}/members",
    tag = "Tenant",
    operation_id = "tenant.memberAdd",
    summary = "添加成员",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    request_body(content = MemberWriteP, description = "成员信息"),
    responses(
        (status = 200, description = "成功", body = MemberEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn member_add_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/tenants/{id}/members/{userID}",
    tag = "Tenant",
    operation_id = "tenant.memberUpdate",
    summary = "更新成员角色",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("userID" = String, Path, description = "成员用户 ID"),
    ),
    request_body(content = MemberUpdateP, description = "角色/状态"),
    responses(
        (status = 200, description = "成功", body = MemberEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn member_update_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/tenants/{id}/members/{userID}",
    tag = "Tenant",
    operation_id = "tenant.memberRemove",
    summary = "移除成员",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("userID" = String, Path, description = "成员用户 ID"),
    ),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn member_remove_doc() {}
