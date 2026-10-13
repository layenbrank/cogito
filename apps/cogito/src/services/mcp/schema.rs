//! MCP 端点的协议形状（JSON-RPC 2.0）。
//!
//! 工具目录、名字映射与协议常量在 `crates/mcp`（能力 crate），这里只放**请求的形状**——
//! 一条 JSON-RPC 消息与 `tools/call` 的参数。响应是动态 JSON（`result` / `error`），
//! 不落成结构体，由 controller 直接序列化。

use serde::Deserialize;
use serde_json::Value;

/// 一条 JSON-RPC 请求（`id` 为 `None` 表示 notification，不响应）。
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    #[serde(default)]
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

/// `tools/call` 的参数：工具名 + 参数对象。
#[derive(Debug, Deserialize)]
pub struct CallToolParams {
    pub name: String,
    #[serde(default)]
    pub arguments: Value,
}
