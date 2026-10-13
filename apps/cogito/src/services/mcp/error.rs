//! MCP 端点的协议错误（JSON-RPC 2.0 的 `error` 对象）。
//!
//! 与 REST 域的 `Exception` 是两个体系：MCP 是 JSON-RPC，错误用一个 `code: i64` +
//! `message` 的对象表达，HTTP 状态码恒为 200（协议错误也如此，除了 HTTP 层鉴权失败）。

use serde::Serialize;

/// JSON-RPC 2.0 错误对象。
#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    /// 请求体不是合法 JSON（或 `jsonrpc` 不是 "2.0"）。
    pub fn parse_error(message: impl Into<String>) -> Self {
        Self::new(mcp::PARSE_ERROR, message)
    }

    /// 请求结构不合法（缺 `method` 等）。
    pub fn invalid_request(message: impl Into<String>) -> Self {
        Self::new(mcp::INVALID_REQUEST, message)
    }

    /// 方法不存在。
    pub fn method_not_found(method: &str) -> Self {
        Self::new(mcp::METHOD_NOT_FOUND, format!("Method not found: {method}"))
    }

    /// 参数不合法（缺字段、类型不对、工具名不认识）。
    pub fn invalid_params(message: impl Into<String>) -> Self {
        Self::new(mcp::INVALID_PARAMS, message)
    }

    /// 内部错误（不应暴露细节给客户端）。
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(mcp::INTERNAL_ERROR, message)
    }

    /// 工具需要人工审批，MCP 装不下审批半程。
    pub fn requires_approval(name: &str) -> Self {
        Self::new(
            mcp::TOOL_REQUIRES_APPROVAL,
            format!("工具 {name} 需要人工审批，请走服务端 agent 审批通道"),
        )
    }
}
