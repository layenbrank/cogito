//! MCP 端点的方法分发。
//!
//! 只实现客户端（goose）会用到的四个方法：`initialize` / `tools/list` / `tools/call` / `ping`。
//! 读工具（`knowledge_search` / `asset_read` / `memory_recall`）转发给 ai-worker 的直通通道；
//! 写工具（`memory_write` / `asset_visibility_write`）**进目录但调用即拒绝**——它们需要人工审批，
//! 而 MCP 是同步协议，装不下审批这半程，要写长期记忆或改可见性请走服务端 agent
//! （`POST /api/v1/agent/tasks`）。

use std::sync::Arc;

use mcp::{MCP_PROTOCOL_VERSION, ai_worker_name, tools, write_tools};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::clients::ai_worker::{
    AgentToolCall, AgentToolInvocationRequest, AiWorkerClient, AiWorkerError, CallMeta,
    INTERNAL_SCHEMA_VERSION,
};
use crate::services::mcp::error::RpcError;
use crate::services::mcp::schema::CallToolParams;

pub struct McpService;

impl McpService {
    /// 分发一条 JSON-RPC 方法调用，返回 `result`（`Err` 时由 controller 包成 `error` 对象）。
    pub async fn handle(
        ai_worker: Option<&Arc<AiWorkerClient>>,
        tenant_id: &str,
        embed_model: &str,
        method: &str,
        params: Option<Value>,
        traceparent: Option<String>,
    ) -> Result<Value, RpcError> {
        match method {
            "initialize" => Ok(Self::initialize()),
            "tools/list" => Ok(Self::tools_list()),
            "tools/call" => {
                Self::call_tool(ai_worker, tenant_id, embed_model, params, traceparent).await
            }
            "ping" => Ok(json!({})),
            other => Err(RpcError::method_not_found(other)),
        }
    }

    fn initialize() -> Value {
        json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "cogito",
                "version": env!("CARGO_PKG_VERSION"),
            },
        })
    }

    fn tools_list() -> Value {
        json!({ "tools": tools() })
    }

    /// `tools/call`：读工具直通 ai-worker，写工具拒绝，不认识的工具报参数错。
    async fn call_tool(
        ai_worker: Option<&Arc<AiWorkerClient>>,
        tenant_id: &str,
        embed_model: &str,
        params: Option<Value>,
        traceparent: Option<String>,
    ) -> Result<Value, RpcError> {
        let params: CallToolParams = serde_json::from_value(params.unwrap_or(Value::Null))
            .map_err(|_| RpcError::invalid_params("tools/call 缺少 name 或参数不合法"))?;

        // 目录里的工具名（含前缀）；不认识的直接报参数错（不是 method_not_found）。
        let Some(tool_name) = ai_worker_name(&params.name) else {
            return Err(RpcError::invalid_params(format!("不存在名为 {} 的工具", params.name)));
        };

        // 写工具进目录但不执行：MCP 装不下审批半程。
        if write_tools().contains(&params.name.as_str()) {
            return Ok(tool_result(
                format!(
                    "工具 {} 需要人工审批，MCP 的同步协议装不下审批这半程，本次**没有执行它**，\
                     也没有产生任何写入或改动。要写长期记忆或改可见性，请走 cogito 的服务端 \
                     agent：起一个 agent 任务，在人工批准之后由它执行。",
                    params.name
                ),
                true,
            ));
        }

        let Some(client) = ai_worker else {
            return Ok(tool_result(
                "ai-worker 未配置（api 进程未接计算车间），工具暂不可用".to_owned(),
                true,
            ));
        };

        let tool_call = AgentToolCall {
            id: "mcp-call".to_owned(),
            name: tool_name.to_owned(),
            // 线格式：参数是 JSON **字符串**（OpenAI 工具调用形状）。
            arguments: Some(params.arguments.to_string()),
            tool_call_type: Some("function".to_owned()),
        };
        let request = AgentToolInvocationRequest {
            schema_version: INTERNAL_SCHEMA_VERSION,
            tenant_id: tenant_id.to_owned(),
            embed_model: embed_model.to_owned(),
            allowed_tools: vec![tool_name.to_owned()],
            tool_call,
        };
        // 幂等键按「工具 + 参数哈希」派生：同一租户同一次调用重发收敛，不同参数是不同调用。
        let idempotency_key = format!(
            "mcp:{}:{}",
            tool_name,
            hash_arguments(&params.arguments.to_string())
        );
        let meta = CallMeta::new(idempotency_key, traceparent);

        match client.agent_tool_invocation(&request, &meta).await {
            Ok(response) => Ok(tool_result(
                response.tool_result.content,
                !response.tool_result.ok,
            )),
            Err(AiWorkerError::Rejected { body, .. }) => Ok(tool_result(body, true)),
            Err(err) => {
                tracing::warn!(error = %err, tool = tool_name, "MCP 工具调用转发 ai-worker 失败");
                Ok(tool_result(
                    format!("ai-worker 暂时不可用，工具调用未完成：{err}"),
                    true,
                ))
            }
        }
    }
}

/// MCP `CallToolResult`：文本内容 + 是否失败（`isError` 为 true 时模型把它当失败读）。
fn tool_result(text: String, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text }],
        "isError": is_error,
    })
}

/// sha256 前 64 个十六进制字符（幂等键里参数的一小段稳定指纹）。
fn hash_arguments(arguments: &str) -> String {
    let digest = Sha256::digest(arguments.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}
