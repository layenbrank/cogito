use super::common::{
    EmptyEnvelope, Exception, ModelEnvelope, ModelListEnvelope, PlansEnvelope, ProviderEnvelope,
    ProviderListEnvelope, SelfQuotaEnvelope,
};
use crate::services::gateway::schema::{
    ChatCompletionsP, EmbeddingsP, ModelUpdateP, ModelWriteP, ProviderUpdateP, ProviderWriteP,
    ServiceTokenP, ServiceTokenR,
};
use crate::services::upload::schema::AssetR;

#[utoipa::path(
    post,
    path = "/api/v1/service/token",
    tag = "Service",
    operation_id = "service.token",
    summary = "服务身份令牌（内部）",
    description = "**仅限受信服务进程**（当前只有 compute）：用共享的 `X-Internal-Token` 换取一枚短期令牌，\n\n\
        令牌自带作用域：`scope=embeddings`（缺省）限定 `tenantID` + `model`，\n\
        `scope=chat` 限定 `tenantID` + `model`，`scope=asset-read` 限定 `tenantID` + 单个 `assetID`。\n\
        `scope=asset-write` 还要 `approvalID`：cogito 在这一刻回读审批台账，核对「批的就是这个资产、\n\
        批的人是它的创建者」，再把审批原文里的可见性与名单签名进令牌——之后写端点只看令牌。\n\
        受众由 `scope` 决定并在消费端点写死，\n\
        所以换成嵌入的令牌打不开资产内容端点或对话端点，反之亦然（`300002`，HTTP 401）。\n\
        这不是用户端点，没有 JWT 也不会带上 `traceparent` 之外的会话语义。\n\
        换取失败一律按错误信封返回；租户不存在返回 404。`scope=asset-read` 时作用域里引用的资产在签发前先校验：\n\
        不存在或对本租户不可见返回 `500204`（HTTP 404），尚未完成上传返回 `200003`（HTTP 400）；\n\
        `scope=asset-write` 时审批不合规（不存在 / 未批准 / 参数与资产不符 / 批准人不是创建者）返回 `500509`（HTTP 403）。",
    request_body(content = ServiceTokenP, description = "作用域申请"),
    responses(
        (status = 200, description = "成功（raw JSON，不套信封）", body = ServiceTokenR),
        (status = "default", description = "业务异常（内部令牌无效 / 租户不存在 / 端点未启用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn service_token_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/service/embeddings",
    tag = "Service",
    operation_id = "service.embeddings",
    summary = "嵌入转发（内部）",
    description = "**仅限受信服务进程**：用 `X-Service-Token` 携带的短期令牌调用，模型取自令牌作用域\
        （请求体里给了不一致的 `model` 会 400），`input`/`dimensions` 等字段原样透传给上游供应商。\
        cogito 仍是唯一出网点：配额预检、用量与审计记账都走与聊天相同的路径。",
    request_body(content = EmbeddingsP, description = "OpenAI 兼容嵌入请求（`model` 可省）"),
    responses(
        (status = 200, description = "成功（raw 上游 JSON）", body = Object),
        (status = "default", description = "业务异常（令牌无效或过期 / 模型未声明 embeddings 能力 / 配额已用尽 / 上游失败）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn service_embeddings_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/service/chat/completions",
    tag = "Service",
    operation_id = "service.chat",
    summary = "聊天转发（内部）",
    description = "**仅限受信服务进程**：用 `scope=chat` 换来的 `X-Service-Token` 调用，模型取自令牌作用域\
        （请求体里给了不一致的 `model` 会 400），`messages`/`tools`/`tool_choice` 等字段原样透传给上游供应商。\n\n\
        一律非流式：`stream` 被强制为 `false`——调用方是机器，请求与响应一对一才谈得上活动级重试与幂等键。\n\
        模型能力门禁在目录这一层：显式声明 `capabilities.tools=false` 的模型会被拒（400），\n\
        未声明 `capabilities` 的按支持工具处理（与用户面 `supports_tools` 同口径）。\n\
        走的是用户面同一个转发与记账路径：配额预检、用量与审计记账完全共用，\n\
        用量行主体为服务主体（全零 UUID），租户取自令牌。",
    request_body(content = ChatCompletionsP, description = "OpenAI 兼容请求（`model` 须与令牌作用域一致）"),
    responses(
        (status = 200, description = "成功（raw 上游 JSON）", body = Object),
        (status = "default", description = "业务异常（令牌无效或过期 / 模型与作用域不一致 / 模型不支持工具调用 / 配额已用尽 / 上游失败）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn service_chat_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/service/assets/{id}/content",
    tag = "Service",
    operation_id = "service.assetContent",
    summary = "资产内容读取（内部）",
    description = "**仅限受信服务进程**：用 `scope=asset-read` 换来的 `X-Service-Token` 按资产 id 读取**原始内容**（流式拼接 CAS 分片）。\n\n\
        授权来自令牌而不是路径：作用域里的 `assetID` 是唯一授权依据，路径参数只用于比对，\n\
        不一致返回 `400004`（HTTP 403）——拿 A 的令牌换不出 B 的内容。\n\
        租户作用域的行级策略决定可见性：别的租户的行等同不存在（`500204`，HTTP 404，不暴露存在性）；\n\
        本租户内尚未完成上传的资产返回 `200003`。\n\
        受众是硬边界：嵌入受众的令牌打到这里一律 `300002`（HTTP 401），反之亦然。\n\
        这是 compute 取分片字节的通道，不做用量计量（计量发生在出站调用上）。",
    params(
        ("id" = String, Path, description = "资产 UUID（须与令牌作用域一致）", example = "550e8400-e29b-41d4-a716-446655440000")
    ),
    responses(
        (status = 200, description = "文件二进制流", content_type = "application/octet-stream"),
        (status = "default", description = "业务异常（令牌无效或过期 / 受众不符 / 作用域与路径不符 / 资产不存在或未完成 / 端点未启用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn service_asset_content_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/service/assets/{id}/visibility",
    tag = "Service",
    operation_id = "service.assetVisibility",
    summary = "资产可见性写入（内部，须已批准）",
    description = "**仅限受信服务进程**：用 `scope=asset-write` 换来的 `X-Service-Token` 改一个资产的可见性。\n\n\
        这是唯一一个「写」的服务身份端点，也是唯一一处**人批过才动得了**的机器写：\n\
        改成什么样、给谁看，都在换令牌时由人批过，并签名进了令牌（见 `POST /api/v1/service/token`）。\n\
        **没有请求体**；路径参数只用于比对令牌里的 `assetID`，不一致返回 `400004`（HTTP 403）。\n\
        写以批准人的身份落地：资产行的写策略只认 `creator`，而签发时已核对「批准人 = 创建者」，\n\
        所以只有创建者自己的资产改得动；令牌里的可见性字面量必须认识，名单必须是 uuid 且只在\n\
        `RESTRICTED` 下出现，任何一条不成立都按「令牌无效」处理（`300002`，HTTP 401）。\n\
        资产不存在或不在令牌租户/批准人视野内返回 `500204`（HTTP 404）。\n\
        受众是硬边界：别的受众的令牌打到这里一律 `300002`（HTTP 401），反之亦然。\n\
        响应是裸结构（不是信封），与取令牌口径一致。",
    params(
        ("id" = String, Path, description = "资产 UUID（须与令牌作用域一致）", example = "550e8400-e29b-41d4-a716-446655440000")
    ),
    responses(
        (status = 200, description = "成功（raw JSON，不套信封）", body = AssetR),
        (status = "default", description = "业务异常（令牌无效或过期 / 受众不符 / 作用域与路径不符 / 无权写入该资产 / 资产不存在 / 端点未启用）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn service_asset_visibility_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/gateway/chat/completions",
    tag = "Gateway",
    operation_id = "gateway.chat",
    summary = "模型转发（OpenAI 兼容）",
    description = "需要 JWT。body 兼容 OpenAI chat/completions；stream=true 返回 SSE，否则返回原始 JSON。\
        带 `X-Tenant-ID` 时按该租户作用域执行（需为成员或平台管理员，否则 403）；不带则按账号作用域，只见全局目录。",
    security(("bearer_auth" = [])),
    request_body(content = ChatCompletionsP, description = "OpenAI 兼容请求"),
    responses(
        (status = 200, description = "成功（raw OpenAI 响应）", body = Object),
        (status = "default", description = "业务异常（鉴权/白名单/配额错误）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn chat_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/models",
    tag = "Gateway",
    operation_id = "gateway.models",
    summary = "可用模型列表",
    description = "返回当前作用域可见的模型：本租户私有行 + 全局行（带 `X-Tenant-ID` 且为成员时）；\
        不带租户头时只剩全局行。行可见性由数据库行级策略兜底，再按平台/租户角色过滤。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = ModelListEnvelope),
        (status = "default", description = "业务异常（未登录）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn models_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/quota/me",
    tag = "Gateway",
    operation_id = "gateway.quotaMe",
    summary = "自助配额（只读）",
    description = "返回当前身份此刻的日窗用量与上限，口径与聊天热路径同源（模型覆盖 > 档位 > 免费档）。\
        带 `X-Tenant-ID` 且确为成员时按租户作用域回答，否则 403；不带租户头时按账号作用域回答。",
    security(("bearer_auth" = [])),
    params(
        ("model" = Option<String>, Query, description = "目录里的模型名；缺省或 auto 时按身份级配额回答"),
    ),
    responses(
        (status = 200, description = "成功", body = SelfQuotaEnvelope),
        (status = "default", description = "业务异常（未登录）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn quota_me_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/plans",
    tag = "Gateway",
    operation_id = "gateway.plans",
    summary = "档位目录",
    description = "可开通档位（档位名 + 日 token 配额）与免费档基线，来自服务端配置而非数据库。",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = PlansEnvelope),
        (status = "default", description = "业务异常（未登录）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn plans_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/providers",
    tag = "Gateway",
    operation_id = "gateway.providers",
    summary = "供应商列表",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = ProviderListEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn providers_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/gateway/providers",
    tag = "Gateway",
    operation_id = "gateway.providerWrite",
    summary = "创建供应商",
    security(("bearer_auth" = [])),
    request_body(content = ProviderWriteP, description = "供应商信息"),
    responses(
        (status = 200, description = "成功", body = ProviderEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn provider_write_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/gateway/providers/{id}",
    tag = "Gateway",
    operation_id = "gateway.providerUpdate",
    summary = "更新供应商",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "供应商 ID")),
    request_body(content = ProviderUpdateP, description = "供应商信息"),
    responses(
        (status = 200, description = "成功", body = ProviderEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn provider_update_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/gateway/providers/{id}",
    tag = "Gateway",
    operation_id = "gateway.providerRemove",
    summary = "删除供应商",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "供应商 ID")),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn provider_remove_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/admin/models",
    tag = "Gateway",
    operation_id = "gateway.modelsAdmin",
    summary = "模型列表（后台）",
    security(("bearer_auth" = [])),
    responses(
        (status = 200, description = "成功", body = ModelListEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn models_admin_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/gateway/admin/models",
    tag = "Gateway",
    operation_id = "gateway.modelWrite",
    summary = "创建模型",
    security(("bearer_auth" = [])),
    request_body(content = ModelWriteP, description = "模型信息"),
    responses(
        (status = 200, description = "成功", body = ModelEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn model_write_doc() {}

#[utoipa::path(
    put,
    path = "/api/v1/gateway/admin/models/{id}",
    tag = "Gateway",
    operation_id = "gateway.modelUpdate",
    summary = "更新模型",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "模型 ID")),
    request_body(content = ModelUpdateP, description = "模型信息"),
    responses(
        (status = 200, description = "成功", body = ModelEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn model_update_doc() {}

#[utoipa::path(
    delete,
    path = "/api/v1/gateway/admin/models/{id}",
    tag = "Gateway",
    operation_id = "gateway.modelRemove",
    summary = "删除模型",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "模型 ID")),
    responses(
        (status = 200, description = "成功", body = EmptyEnvelope),
        (status = "default", description = "业务异常（未找到）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn model_remove_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/usage",
    tag = "Gateway",
    operation_id = "gateway.usage",
    summary = "用量报表",
    description = "仅平台 ADMIN。运行在平台特权作用域，可见**所有**租户的用量（含无租户的账号级行）；\
        `tenantID` 是查询过滤条件，不是可见性边界。",
    security(("bearer_auth" = [])),
    params(
        ("tenantID" = Option<String>, Query, description = "租户 ID"),
        ("modelID" = Option<String>, Query, description = "模型 ID"),
        ("from" = Option<i64>, Query, description = "起始毫秒时间戳"),
        ("to" = Option<i64>, Query, description = "结束毫秒时间戳"),
        ("page" = Option<u32>, Query, description = "页码"),
        ("size" = Option<u32>, Query, description = "每页条数"),
    ),
    responses(
        (status = 200, description = "成功", body = Object),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn usage_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/audit",
    tag = "Gateway",
    operation_id = "gateway.audit",
    summary = "审计日志",
    description = "仅平台 ADMIN。运行在平台特权作用域，可见**所有**租户的审计；`tenantID` 是查询过滤条件，不是可见性边界。\n\n\
        `action` 精确匹配（如 `gateway.chat`），`actor` 为操作者用户 ID，`from`/`to` 是闭区间毫秒时间戳；\n\n\
        `from` 晚于 `to` 一律 `200003`（HTTP 400），非法 UUID 不会被静默忽略。",
    security(("bearer_auth" = [])),
    params(
        ("tenantID" = Option<String>, Query, description = "租户 ID"),
        ("actor" = Option<String>, Query, description = "操作者用户 ID（精确匹配）"),
        ("action" = Option<String>, Query, description = "动作（精确匹配，如 `gateway.chat`）"),
        ("from" = Option<i64>, Query, description = "起始毫秒时间戳（含）"),
        ("to" = Option<i64>, Query, description = "结束毫秒时间戳（含）"),
        ("page" = Option<u32>, Query, description = "页码"),
        ("size" = Option<u32>, Query, description = "每页条数"),
    ),
    responses(
        (status = 200, description = "成功", body = Object),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn audit_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/gateway/audit/export",
    tag = "Gateway",
    operation_id = "gateway.auditExport",
    summary = "导出审计日志（平台）",
    description = "仅平台 ADMIN，与 `gateway.audit` 同一组过滤条件与同一份可见性（所有租户），但返回**文件流**而不是 JSON。\n\n\
        过滤条件缺省时窗口补齐为「最近 30 天」（`from`/`to` 都不给才补，给了一端就只补另一端）；\n\n\
        导出有硬上限，命中上限时 `X-Export-Truncated` 为 `true` 且只返回上限内的行——**先按过滤条件收窄再导出**。\n\n\
        `format=csv`（缺省）返回 `text/csv; charset=utf-8`，带 UTF-8 BOM 且字段按 RFC 4180 转义；\n\n\
        `format=ndjson` 返回 `application/x-ndjson`，每行一个对象、`createdAt` 为毫秒时间戳。\n\n\
        文件名由 `Content-Disposition` 给出，形如 `audit-<from>-<to>.<ext>`，时间戳即**实际生效**的窗口，\n\n\
        消费方不必回看响应头。",
    security(("bearer_auth" = [])),
    params(
        ("tenantID" = Option<String>, Query, description = "租户 ID"),
        ("actor" = Option<String>, Query, description = "操作者用户 ID（精确匹配）"),
        ("action" = Option<String>, Query, description = "动作（精确匹配，如 `gateway.chat`）"),
        ("from" = Option<i64>, Query, description = "起始毫秒时间戳（含）"),
        ("to" = Option<i64>, Query, description = "结束毫秒时间戳（含）"),
        ("format" = Option<String>, Query, description = "导出格式：`csv`（缺省，Excel 友好）或 `ndjson`（SIEM / 流式消费友好）"),
    ),
    responses(
        (status = 200, description = "审计文件流（`text/csv` 或 `application/x-ndjson`）；`X-Export-Rows` 为实际行数，`X-Export-Truncated` 为是否命中硬上限，`Content-Disposition` 给出文件名"),
        (status = "default", description = "业务异常（权限不足或参数非法）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn audit_export_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/audit",
    tag = "Gateway",
    operation_id = "gateway.tenantAudit",
    summary = "审计日志（本租户）",
    description = "租户 OWNER / ADMIN（`audit_event:read`）。可见性由租户作用域收口：**只返回本租户的行**，\n\n\
        普通成员一律 403。`tenantID` 与路径一致时按缺省处理，不一致即 `200003`（HTTP 400，提示改用平台接口），\n\n\
        所以拿这个端点做跨租户汇总永远拿不到别人的数据。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("tenantID" = Option<String>, Query, description = "租户 ID（与路径一致或缺省，否则报参数错误）"),
        ("actor" = Option<String>, Query, description = "操作者用户 ID（精确匹配）"),
        ("action" = Option<String>, Query, description = "动作（精确匹配，如 `gateway.chat`）"),
        ("from" = Option<i64>, Query, description = "起始毫秒时间戳（含）"),
        ("to" = Option<i64>, Query, description = "结束毫秒时间戳（含）"),
        ("page" = Option<u32>, Query, description = "页码"),
        ("size" = Option<u32>, Query, description = "每页条数"),
    ),
    responses(
        (status = 200, description = "成功", body = Object),
        (status = "default", description = "业务异常（权限不足或租户不匹配）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn tenant_audit_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/audit/export",
    tag = "Gateway",
    operation_id = "gateway.tenantAuditExport",
    summary = "导出审计日志（本租户）",
    description = "与 `gateway.tenantAudit` 同一套过滤条件、同一份可见性与同一个权限判定，返回**文件流**。\n\n\
        响应头与格式同 `gateway.auditExport`：缺省窗口为最近 30 天，`X-Export-Rows` / `X-Export-Truncated` 描述行数与截断，\n\n\
        `Content-Disposition` 给出带实际窗口的文件名。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("tenantID" = Option<String>, Query, description = "租户 ID（与路径一致或缺省，否则报参数错误）"),
        ("actor" = Option<String>, Query, description = "操作者用户 ID（精确匹配）"),
        ("action" = Option<String>, Query, description = "动作（精确匹配，如 `gateway.chat`）"),
        ("from" = Option<i64>, Query, description = "起始毫秒时间戳（含）"),
        ("to" = Option<i64>, Query, description = "结束毫秒时间戳（含）"),
        ("format" = Option<String>, Query, description = "导出格式：`csv`（缺省）或 `ndjson`"),
    ),
    responses(
        (status = 200, description = "审计文件流（`text/csv` 或 `application/x-ndjson`），响应头同平台导出"),
        (status = "default", description = "业务异常（权限不足、租户不匹配或参数非法）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn tenant_audit_export_doc() {}
