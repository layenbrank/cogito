use crate::oas::common::{
    EmptyEnvelope, Exception, QuotaEnvelope, SubscriptionEnvelope, SubscriptionListEnvelope,
};
use crate::services::subscription::schema::SubscribeP;

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/subscriptions",
    tag = "Subscription",
    operation_id = "subscription.toList",
    summary = "租户订阅历史",
    description = "返回该租户的全部订阅（含已取消 / 已到期），按创建时间倒序。\n\n个人租户的当日配额取决于此刻生效的订阅档位：有效订阅档位 > 免费档；团队租户与无租户身份走全局配额。\n\n需 JWT；调用者须为该租户 ACTIVE 成员（平台 ADMIN 可旁路）。\n\n`body.code`：200000 成功；非成员为权限类错误码。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = SubscriptionListEnvelope),
        (status = "default", description = "业务异常（非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toList_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants/{id}/subscriptions",
    tag = "Subscription",
    operation_id = "subscription.toWrite",
    summary = "开通 / 续订订阅",
    description = "为**个人租户**开通或续订订阅（付费档位）。订阅**创建即生效**（`createdAt` 即生效时间）。\n\n同一时刻最多一条生效订阅：调用时会先把该租户仍为 ACTIVE 的旧订阅作废（未过期的 `expiresAt` 截断到当前时间），再插入新订阅。\n\n`plan` 必须存在于配置 `gateway.plan_daily_token_quota`；`expiresAt` 缺省或 null 表示永久有效。团队租户不可订阅（回落全局配额）。\n\n需 JWT；调用者须为租户 OWNER/ADMIN（平台 ADMIN 可旁路）。\n\n`body.code`：200000 成功；参数类错误码用于档位不存在、到期时间非法、非个人租户。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    request_body(content = SubscribeP, description = "订阅信息"),
    responses(
        (status = 200, description = "成功", body = SubscriptionEnvelope),
        (status = "default", description = "业务异常（参数错误 / 权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toWrite_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/tenants/{id}/subscriptions/{subscriptionID}",
    tag = "Subscription",
    operation_id = "subscription.toRemove",
    summary = "取消订阅",
    description = "立即取消订阅：状态置为 CANCELED，并把有效期截断到当前时间；该租户配额随即回落免费档。\n\n需 JWT；调用者须为租户 OWNER/ADMIN（平台 ADMIN 可旁路）。\n\n`body.code`：200000 成功；订阅不存在或不属于该租户返回未找到类错误码。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("subscriptionID" = String, Path, description = "订阅 ID"),
    ),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRemove_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/quota",
    tag = "Subscription",
    operation_id = "subscription.quota",
    summary = "当前生效配额",
    description = "返回该租户当前生效的日 token 配额及其来源：\n\n- `PLAN`：个人租户且有此刻生效的订阅，取 `gateway.plan_daily_token_quota[plan]`\n- `FREE`：个人租户无有效订阅（含订阅已过期、未知档位回落）\n- `GLOBAL`：团队租户或无租户身份\n\n需 JWT；调用者须为该租户 ACTIVE 成员（平台 ADMIN 可旁路）。\n\n注：单个模型可用 `gateway_model.dailyTokenQuota` 覆盖该值。\n\n`body.code`：200000 成功；非成员为权限类错误码。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = QuotaEnvelope),
        (status = "default", description = "业务异常（非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn quota_doc() {}
