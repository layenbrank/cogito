use super::common::Exception;

/// `X-Tenant-ID` 在 MCP 域是**必填**请求头：工具只读/只写本租户的数据（检索、资产正文、
/// 长期记忆都按租户隔离），没有「账号级」的落脚点。缺头直接 400。
fn tenant_header() -> String {
    "目标租户 ID（UUID）。**必填**：工具的数据面按租户隔离，缺了这个头没有正确的作用域可进。\n\
     调用者须为该租户有效成员（平台 ADMIN 可旁路）。"
        .to_string()
}

#[utoipa::path(
    post,
    path = "/api/v1/mcp",
    tag = "Mcp",
    operation_id = "mcp.handle",
    summary = "MCP 端点（JSON-RPC 2.0 over streamable HTTP）",
    description = "供 MCP 客户端（如 goose）接入的服务端工具面。只实现 **POST**（纯 JSON 响应，\n\
        **不支持 SSE** 的服务端推送），客户端探测到不支持 SSE 后按规范退化为无通知模式，\n\
        这不影响 `tools/list` / `tools/call` 的同步往返。\n\n\
        **响应不走统一 REST 信封**：成功回 `{\"jsonrpc\":\"2.0\",\"id\":…,\"result\":…}`，\n\
        协议错误回 `{\"jsonrpc\":\"2.0\",\"id\":…,\"error\":{…}}`，HTTP 状态码恒为 200；\n\
        无 `id` 的通知（`notifications/*`）按规范回 202 空体。只有 HTTP 层鉴权失败\n\
        （未登录 / 非租户成员）才走统一错误信封（401 / 403）。\n\n\
        **方法**：`initialize`（握手）、`tools/list`（工具目录）、`tools/call`（执行一次调用）、\n\
        `ping`。\n\n\
        **工具目录**（前缀 `cogito_`，五个）：`cogito_knowledge_search` / `cogito_asset_read` /\n\
        `cogito_memory_recall` 三个**读**工具同步执行（转发 compute 的直通通道）；\n\
        `cogito_memory_write` / `cogito_asset_visibility_write` 两个**写**工具进目录但\n\
        **调用即拒绝**——它们需要人工审批，而 MCP 的同步协议装不下审批这半程，\n\
        要写长期记忆或改可见性请走服务端 agent（`POST /api/v1/agent/tasks`）。",
    security(("bearer_auth" = [])),
    params(("X-Tenant-ID" = String, Header, description = tenant_header())),
    request_body(content = Object, description = "一条 JSON-RPC 2.0 消息（`initialize` / `tools/list` / `tools/call` / `ping`）"),
    responses(
        (status = 200, description = "JSON-RPC 响应（`result` 或 `error`）。无 `id` 的通知（`notifications/*`）按规范回 202 空体", body = Object, content_type = "application/json"),
        (status = "default", description = "HTTP 层鉴权失败（未登录 / 缺少 X-Tenant-ID / 非租户成员）：响应体为统一错误信封", body = Exception),
    )
)]
pub fn handle_doc() {}
