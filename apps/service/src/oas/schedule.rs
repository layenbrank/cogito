use super::common::{Exception, JobEnvelope, JobListEnvelope, JobRemovedEnvelope};
use crate::services::schedule::schema::{JobPatchP, JobP};

/// `X-Tenant-ID` 在定时任务域是**必填**：任务属于一个租户，`runAsKind=user` 时要按它
/// 校验执行人仍是该租户成员。缺头直接 400，不猜默认租户。
fn tenant_header() -> String {
    "目标租户 ID（UUID）。**必填**：任务归属与执行身份都按这个租户判定。\n\
     调用者须为该租户有效成员，且具备 agent 任务的读/写权限（平台 ADMIN 可旁路）。"
        .to_string()
}

#[utoipa::path(
    get,
    path = "/api/v1/automations",
    tag = "Automation",
    operation_id = "schedule.list",
    summary = "列出本租户的定时任务",
    description = "按创建时间升序返回任务定义与最近一次执行状态。\n\n\
        `lastStatus` 记的是**「把任务起起来了」**：`running` = worker 已认领并在起 agent 任务；\n\
        `succeeded` = 起成功（真正的执行结果在 `lastTaskID` 指向的 agent 任务里）；\n\
        `failed` 时看 `lastError`。\n\n\
        `nextRunAt` 是下次触发时间（epoch ms），停用时为空。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    responses(
        (status = 200, description = "成功（可能为空列表）", body = JobListEnvelope),
        (status = "default", description = "业务异常（未登录 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn list_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/automations",
    tag = "Automation",
    operation_id = "schedule.save",
    summary = "新建或整体替换一个定时任务",
    description = "`id` 为空是新建，非空是整体替换（同租户内找不到该 id 回 404）。\n\n\
        **cron 与 timezone 在保存时就校验**：表达式要 5 段（分 时 日 月 周），时区要 IANA 名；\n\
        写错当场 400，不会留下一条永远算不出下次时间、每轮 tick 都刷错的任务。\n\
        cron 按任务自己的 `timezone` 解释（缺省 `Asia/Shanghai`），`nextRunAt` 由服务端算，\n\
        请求里带的值会被忽略。\n\n\
        `runAsKind`：`user` = 以创建人（或 `runAsUserId` 指定的本人）身份执行，执行时仍会校验\n\
        其为该租户成员；`tenant` = 以租户服务身份执行（团队共享场景）。\n\n\
        `enabled=false` 时不排期（`nextRunAt` 为空）。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员，并具备 agent 任务写权限。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500801` 任务不存在（带 id 时）；`500802` cron 或时区不合法；`500803` 名称为空或执行身份非法。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    request_body(content = JobP, description = "任务定义"),
    responses(
        (status = 200, description = "成功（返回落库后的任务，含算好的 nextRunAt）", body = JobEnvelope),
        (status = "default", description = "业务异常（参数不合法 / 任务不存在 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn save_doc() {}

#[utoipa::path(
    patch,
    path = "/api/v1/automations/{id}",
    tag = "Automation",
    operation_id = "schedule.patch",
    summary = "局部更新一个定时任务",
    description = "只改传入的字段；其余保持不变。\n\n\
        **启用会从「现在」重排**，不会补停用期间错过的时间点；停用会清空 `nextRunAt`。\n\
        改 cron 或时区同样会重排，并立刻返回新的 `nextRunAt`。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员，并具备 agent 任务写权限。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500801` 任务不存在；`500802` cron 或时区不合法；`500803` 执行身份非法。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("id" = String, Path, description = "任务 ID（UUID）"),
    ),
    request_body(content = JobPatchP, description = "要修改的字段"),
    responses(
        (status = 200, description = "成功", body = JobEnvelope),
        (status = "default", description = "业务异常（任务不存在 / 参数不合法 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn patch_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/automations/{id}",
    tag = "Automation",
    operation_id = "schedule.remove",
    summary = "删除一个定时任务",
    description = "删除后不会再被 worker 认领；已经起出来的 agent 任务不受影响（它有自己的台账）。\n\n\
        返回被删除的行数（0 或已回 404，正常是 1）。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员，并具备 agent 任务写权限。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500801` 任务不存在（含不属于该租户与 id 不是 UUID，三者合并避免用 id 探测别的租户）。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("id" = String, Path, description = "任务 ID（UUID）"),
    ),
    responses(
        (status = 200, description = "成功（被删除的行数）", body = JobRemovedEnvelope),
        (status = "default", description = "业务异常（任务不存在 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn remove_doc() {}
