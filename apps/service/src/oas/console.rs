//! Backend Console 偏好契约（仅平台 ADMIN）。

use super::common::{Exception, PreferenceEnvelope};
use crate::services::console::schema::PreferenceP;

#[utoipa::path(
    get,
    path = "/api/v1/console/preference",
    tag = "Console",
    operation_id = "console.toRead",
    summary = "读取控制台偏好",
    description = "仅平台 ADMIN。返回当前管理员的侧栏序 / 钉选 / 看板小部件 / 书签；尚无记录时 data 为 null。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功（code=200000）", body = PreferenceEnvelope),
        (status = "default", description = "业务异常（未登录或权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/console/preference",
    tag = "Console",
    operation_id = "console.toUpdate",
    summary = "写入控制台偏好",
    description = "仅平台 ADMIN。按当前登录管理员 upsert 一行偏好。",
    security(("bearer_auth" = [])),
    request_body(
        content = PreferenceP,
        description = "偏好内容",
        example = json!({
            "navOrder": ["overview", "users", "providers"],
            "pinnedNav": ["overview"],
            "dashboardWidgets": ["health", "usage", "providers", "approvals"],
            "bookmarks": []
        })
    ),
    responses(
        (status = 200, description = "成功（code=200000）", body = PreferenceEnvelope),
        (status = "default", description = "业务异常（参数非法或权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toUpdate_doc() {}
