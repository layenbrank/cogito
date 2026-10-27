//! `cogito-mcp` —— 本地工具面的 stdio MCP 侧车（由 goose 按需拉起）。
//!
//! 本进程**不直接打开 `cogito-client.db`**：它把 `tools/list` / `tools/call` 代理到
//! app 内的 loopback 桥（`apps/client/src-tauri/src/bridge`），由 app 侧执行，
//! 保持「app 是数据库唯一写者」。
//!
//! 环境变量（由 ACP 注入）：
//! - `COGITO_BRIDGE_URL` / `COGITO_BRIDGE_TOKEN`：桥地址与本次启动的令牌
//! - `COGITO_SESSION_ID` / `COGITO_WORKSPACE_ID`：会话上下文（当前仅留痕，不参与鉴权）
//!
//! 缺 URL 或 token 时退化为只提供 `app_ping`，并把原因写进 instructions —— 让模型/用户
//! 看到「工具面未连接」，而不是静默地一无所获。
use std::sync::Arc;

use rmcp::{
    ErrorData as McpError, ServerHandler, ServiceExt,
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
        JsonObject, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig,
        Tool,
    },
    service::{RequestContext, RoleServer},
    transport::stdio,
};
use serde_json::{Value, json};

/// 与 `bridge::http::TOKEN_HEADER` 对齐。
const TOKEN_HEADER: &str = "x-bridge-token";
const BRIDGE_URL_ENV: &str = "COGITO_BRIDGE_URL";
const BRIDGE_TOKEN_ENV: &str = "COGITO_BRIDGE_TOKEN";

/// loopback 桥的客户端；只走 http，故不启用 TLS。
#[derive(Clone)]
struct Bridge {
    url: String,
    token: String,
    client: reqwest::Client,
}

impl Bridge {
    fn from_env() -> Option<Self> {
        let url = std::env::var(BRIDGE_URL_ENV).ok()?.trim().to_string();
        let token = std::env::var(BRIDGE_TOKEN_ENV).ok()?.trim().to_string();
        if url.is_empty() || token.is_empty() {
            return None;
        }
        Some(Self {
            url,
            token,
            client: reqwest::Client::new(),
        })
    }

    async fn list_tools(&self) -> Result<Vec<Tool>, String> {
        let body = self.get("/internal/tools/list").await?;
        let entries = body
            .get("tools")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        Ok(entries.into_iter().filter_map(to_tool).collect())
    }

    async fn call_tool(&self, name: &str, arguments: Value) -> Result<String, String> {
        let body = self
            .post(
                "/internal/tools/call",
                json!({ "name": name, "arguments": arguments }),
            )
            .await?;
        if body.get("ok").and_then(Value::as_bool) == Some(true) {
            let value = body.get("value").cloned().unwrap_or(Value::Null);
            return Ok(value.to_string());
        }
        Err(body
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("桥调用失败")
            .to_string())
    }

    async fn get(&self, path: &str) -> Result<Value, String> {
        let response = self
            .client
            .get(format!("{}{path}", self.url))
            .header(TOKEN_HEADER, &self.token)
            .send()
            .await
            .map_err(|error| format!("桥不可达：{error}"))?;
        read_json(response).await
    }

    async fn post(&self, path: &str, payload: Value) -> Result<Value, String> {
        let response = self
            .client
            .post(format!("{}{path}", self.url))
            .header(TOKEN_HEADER, &self.token)
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("桥不可达：{error}"))?;
        read_json(response).await
    }
}

async fn read_json(response: reqwest::Response) -> Result<Value, String> {
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("桥返回 {status}：{text}"));
    }
    response
        .json::<Value>()
        .await
        .map_err(|error| format!("桥响应不是合法 JSON：{error}"))
}

/// 桥给的 `{name, description, inputSchema}` → MCP `Tool`。
fn to_tool(entry: Value) -> Option<Tool> {
    let name = entry.get("name")?.as_str()?.to_string();
    let description = entry
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let schema: JsonObject = entry
        .get("inputSchema")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    Some(Tool::new(name, description, Arc::new(schema)))
}

fn ping_tool() -> Tool {
    Tool::new(
        "app_ping",
        "连通性探测：返回 pong（桥未连接时的占位工具）",
        Arc::new(JsonObject::new()),
    )
}

#[derive(Clone)]
struct App {
    bridge: Option<Bridge>,
}

impl ServerHandler for App {
    fn get_info(&self) -> ServerConfig {
        let instructions = if self.bridge.is_some() {
            "cogito 本地工具面：经 app 内桥读取本机数据（只读）"
        } else {
            "cogito 本地工具面未连接（缺少 COGITO_BRIDGE_URL / COGITO_BRIDGE_TOKEN），仅 app_ping 可用"
        };
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("cogito-mcp", env!("CARGO_PKG_VERSION")))
            .with_instructions(instructions)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = match &self.bridge {
            Some(bridge) => bridge
                .list_tools()
                .await
                .map_err(|error| McpError::internal_error(error, None))?,
            None => vec![ping_tool()],
        };
        Ok(ListToolsResult {
            tools,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let name = request.name.as_ref();
        if name == "app_ping" && self.bridge.is_none() {
            return Ok(CallToolResult::success(vec![ContentBlock::text("pong")]).into());
        }

        let Some(bridge) = &self.bridge else {
            return Ok(CallToolResult::error(vec![ContentBlock::text(
                "本地工具面未连接：COGITO_BRIDGE_URL / COGITO_BRIDGE_TOKEN 缺失",
            )])
            .into());
        };

        let arguments = request.arguments.map(Value::Object).unwrap_or(Value::Null);
        match bridge.call_tool(name, arguments).await {
            Ok(text) => Ok(CallToolResult::success(vec![ContentBlock::text(text)]).into()),
            // 工具级失败：让模型看到原因，而不是抛协议错误
            Err(error) => Ok(CallToolResult::error(vec![ContentBlock::text(error)]).into()),
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // stdout 是 JSON-RPC 通道：任何调试输出都只能走 stderr，否则会污染协议流。
    let app = App {
        bridge: Bridge::from_env(),
    };
    let service = app.serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
