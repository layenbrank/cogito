use super::common::{ApprovalEnvelope, Exception, TaskEnvelope};
use crate::services::agent::schema::{ApprovalP, TaskP};

/// `X-Tenant-ID` 在 agent 域是**必填**请求头：没有「账号级 agent」这种落脚点。
/// 与 gateway 的差别是那里缺头会降级到账号作用域，这里直接 400。
fn tenant_header() -> String {
    "目标租户 ID（UUID）。**必填**：agent 任务的工具作用域（知识库检索 / 资产读取）都按租户划定，\n\
     缺了这个头没有正确的作用域可进。调用者须为该租户有效成员（平台 ADMIN 可旁路）。"
        .to_string()
}

#[utoipa::path(
    post,
    path = "/api/v1/agent/tasks",
    tag = "Agent",
    operation_id = "agent.createTask",
    summary = "起一个 agent 任务",
    description = "给一个目标，服务端自己跑完多轮「模型思考 → 调工具 → 再思考」，最终把答案与过程落进台账。\n\n\
        **立刻返回**：响应里的任务通常还是 `RUNNING`，进度与结果用查询接口取。任务可能跑好几分钟，\n\
        同步等待会把一个 HTTP 请求拖成几分钟，也会让客户端超时重发变成起两个任务。\n\n\
        模型由部署配置决定（`agent.chat_model`），调用方**不能指定**；`maxSteps` 与 `tools` 只能比部署配置更小。\n\
        工具名用下划线（如 `knowledge_search`），不是能力名的点号写法。`tools: []` 是合法输入，\n\
        含义是「不给工具，只要一条结论」。\n\n\
        agent 的每一轮模型调用都走 cogito 网关（`scope=chat`），所以**配额、用量与审计自动生效**。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500502` 目标为空或超长；`500504` 轮次上限越界；`500505` 工具不在白名单；\n\
        `500503` 编排运行时未接通或实例启动失败（台账那一行会被落成失败，可直接重试）。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    request_body(content = TaskP, description = "任务目标与可选收窄项"),
    responses(
        (status = 200, description = "成功（任务已受理，通常仍在 RUNNING）", body = TaskEnvelope),
        (status = "default", description = "业务异常（参数错误 / 非租户成员 / 编排不可用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn create_task_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/agent/tasks/{id}",
    tag = "Agent",
    operation_id = "agent.readTask",
    summary = "查询 agent 任务",
    description = "返回任务台账：状态、步数、模型自报的进度、结果与失败原因。\n\n\
        **台账是权威记录**：任务已经结束时不再去问编排，实例存不存在都不影响「这个任务结束了」。\n\
        还在跑时会顺带问一次编排的当前进度（`progress`），问不到不影响返回；\n\
        编排运行时没接通时也照样返回台账原样。\n\n\
        有一处刻意的延迟：台账显示 `RUNNING` 但编排里查不到该实例时，5 分钟内仍按 `RUNNING` 返回，\n\
        超过才判定失败。原因是「刚起、还没被运行时领走」与「实例真丢了」在编排侧长得一样，只有行龄能区分。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500501` 任务不存在、不属于该租户，或 id 不是 UUID（三种情况合并，\n\
        避免用 id 探测别的租户）。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("id" = String, Path, description = "任务 ID（UUID）"),
    ),
    responses(
        (status = 200, description = "成功", body = TaskEnvelope),
        (status = "default", description = "业务异常（任务不存在 / 非租户成员）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn read_task_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/agent/tasks/{id}/approvals/{approvalID}",
    tag = "Agent",
    operation_id = "agent.decideApproval",
    summary = "对一次待审批的工具调用做决定",
    description = "任务跑到需要人工批准的工具（改业务数据的那类）时会**停在原地等**，\
        把「在等哪一次调用」写进查询接口的 `pendingApproval` 字段。这个接口就是人对它的回答。\n\n\
        **批准**：这次调用真的执行，结果照常进任务历史，任务继续跑。\n\
        **驳回**：不执行，模型会收到一条「这次没执行、换个做法」的结果并接着跑。\n\n\
        `approvalID` 对不上、已经批过、任务已经结束，都回 409——决定只认**当前正在等的那一次**。\n\
        同一方向重复提交是幂等的（返回 `applied=false`），不会执行两次。\n\n\
        没人处理时会在 `approvalTtlSecs` 之后超时，任务拿到一条「超时未处理」的结果继续跑；\n\
        超时由编排判定，**不能**由调用方送进来（送 `EXPIRED` 是 422）。\n\n\
        需 JWT 且 `X-Tenant-ID` 指向的租户内有效成员。\n\n\
        `body.code`：200000 成功；`200001` 缺少 `X-Tenant-ID`；`200007` `X-Tenant-ID` 格式无效；\n\
        `500501` 任务不存在或不属于该租户；`500506` 当前没有在等这次调用；\n\
        `500507` 已有相反的决定；`500508` 决定不是 `APPROVED` / `REJECTED`；\n\
        `500503` 编排运行时未接通或决定投递失败（决定已记账，同一方向重发即为补投）。",
    security(("bearer_auth" = [])),
    params(
        ("X-Tenant-ID" = String, Header, description = tenant_header()),
        ("id" = String, Path, description = "任务 ID（UUID）"),
        ("approvalID" = String, Path, description = "待审批项 ID，取自查询接口的 `pendingApproval.approvalID`"),
    ),
    request_body(content = ApprovalP, description = "批准或驳回，驳回时给理由"),
    responses(
        (status = 200, description = "成功（决定已记账）", body = ApprovalEnvelope),
        (status = "default", description = "业务异常（任务不存在 / 没有待审批项 / 决定非法 / 编排不可用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn decide_approval_doc() {}
