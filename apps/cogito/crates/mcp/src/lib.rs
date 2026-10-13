//! MCP 工具面：工具目录与协议常量的**唯一事实来源**。
//!
//! 这里只有纯数据与纯规则（工具名、参数 schema、名字映射、协议版本），没有任何 I/O。
//! HTTP 层与 ai-worker 转发在 `apps/cogito/src/services/mcp`，出站客户端在
//! `apps/cogito/src/clients/ai_worker`。工具名是「名字即权限」的安全边界，所以目录写死在
//! 代码里，并与 ai-worker `tools.py` 的五份参数 schema **逐字对齐**（改了那边要同步这里）。

use serde::Serialize;
use serde_json::{Value, json};

/// JSON-RPC 版本字面量。
pub const RPC_VERSION: &str = "2.0";
/// 本服务宣告的 MCP 协议版本（streamable HTTP，纯 JSON 响应，不支持 SSE）。
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
/// MCP 工具名前缀：`cogito_` + ai-worker 工具名。前缀避免与其它 MCP 服务器撞名。
pub const TOOL_PREFIX: &str = "cogito_";

/// JSON-RPC 错误码（规范定义 + 本服务自定义）。
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;
/// 工具需要人工审批，MCP 的同步协议装不下：请走服务端 agent 审批通道。
pub const TOOL_REQUIRES_APPROVAL: i64 = -32001;

/// 工具目录里的一条工具（MCP `Tool`：`name` / `description` / `inputSchema`）。
#[derive(Debug, Clone, Serialize)]
pub struct ToolListing {
    pub name: &'static str,
    pub description: &'static str,
    #[serde(rename = "inputSchema")]
    pub input_schema: Value,
}

/// 需要人工审批的写工具（MCP 名）。它们**进目录但调用即拒绝**（见 HTTP 层）。
pub fn write_tools() -> &'static [&'static str] {
    &["cogito_memory_write", "cogito_asset_visibility_write"]
}

/// MCP 名 → ai-worker 工具名：剥掉 `cogito_` 前缀。没有前缀的不是本目录里的工具。
pub fn ai_worker_name(mcp_name: &str) -> Option<&'static str> {
    tools()
        .iter()
        .map(|tool| tool.name)
        .find(|name| *name == mcp_name)
        .map(|name| name.strip_prefix(TOOL_PREFIX).expect("目录里的工具都带前缀"))
}

/// MCP 工具目录：五个工具（读三写二），顺序稳定（与 ai-worker `tools.py` 的登记顺序一致）。
pub fn tools() -> Vec<ToolListing> {
    vec![
        ToolListing {
            name: "cogito_knowledge_search",
            description: "在知识库里做语义检索，返回最相近的若干文本块（含所属资产 ID 与相似度）。\
                          凡是需要「资料里怎么说」的依据，都必须先用这个工具取回来；\
                          返回为空表示本租户没有相关内容。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 1,
                        "description": "检索用的自然语言问题或关键词，用中文或原文的语种都可以",
                    },
                    "topK": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20,
                        "description": "最多返回几块，默认 5",
                    },
                },
                "required": ["query"],
                "additionalProperties": false,
            }),
        },
        ToolListing {
            name: "cogito_asset_read",
            description: "读取某个资产的完整正文（纯文本、Markdown、HTML、JSON、PDF 等）。\
                          已知具体资产 ID 且需要看全文时用它；只想知道「哪里有相关内容」时用 knowledge_search。\
                          对图片或扫描件会返回「没有可读文本」。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "assetID": {
                        "type": "string",
                        "format": "uuid",
                        "description": "要读的资产 ID（知识库检索结果里给出的那个）",
                    },
                },
                "required": ["assetID"],
                "additionalProperties": false,
            }),
        },
        ToolListing {
            name: "cogito_memory_recall",
            description: "召回本租户**此前任务**留下的结论与笔记（跨任务共享，不是你的私人记忆）。\
                          开始一个可能与以往经验相关的任务时先用它；\
                          返回为空只表示「以前没记过」，不是「资料里没有」——找资料依据请用 knowledge_search。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "minLength": 1,
                        "description": "描述你要找的东西，例如「上次这类合同是怎么处理的」",
                    },
                    "topK": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 20,
                        "description": "最多召回几条，默认 5",
                    },
                },
                "required": ["query"],
                "additionalProperties": false,
            }),
        },
        ToolListing {
            name: "cogito_memory_write",
            description: "把一条**此后还用得上的**结论写进本租户的长期记忆，供之后的其它任务召回。\
                          只写结论或事实，不要写过程记录；写入是永久副作用，写入前先确认这条内容值得被未来的任务读到。\
                          **这个工具需要人工审批**：MCP 是同步协议，装不下审批这半程，所以本工具在此只能被拒绝，\
                          要写长期记忆请走 cogito 的服务端 agent。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 2000,
                        "description": "要长期记住的内容，写成一句能独立读懂的话（写「结论/事实」，不要写「我查了 X」这类过程记录）",
                    },
                },
                "required": ["content"],
                "additionalProperties": false,
            }),
        },
        ToolListing {
            name: "cogito_asset_visibility_write",
            description: "改一个资产的可见性（PRIVATE / RESTRICTED / PUBLIC，RESTRICTED 需给可见名单）。\
                          只在用户明确要求「把这个资产设为公开/私有/只给某几个人看」时使用。\
                          **这个工具需要人工审批**：MCP 是同步协议，装不下审批这半程，所以本工具在此只能被拒绝，\
                          要改可见性请走 cogito 的服务端 agent。",
            input_schema: json!({
                "type": "object",
                "properties": {
                    "assetID": {
                        "type": "string",
                        "format": "uuid",
                        "description": "要改可见性的资产 ID",
                    },
                    "visibility": {
                        "type": "string",
                        "enum": ["PRIVATE", "RESTRICTED", "PUBLIC"],
                        "description": "目标可见性：PRIVATE 只有创建者与获得授权的人能看见、\
                                        RESTRICTED 只有名单上的人能看见、PUBLIC 本租户全部成员都能看见",
                    },
                    "viewers": {
                        "type": "array",
                        "items": { "type": "string", "format": "uuid" },
                        "description": "可见名单（用户 ID）。只有 visibility 是 RESTRICTED 时才允许给",
                    },
                },
                "required": ["assetID", "visibility"],
                "additionalProperties": false,
            }),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalogue_has_five_tools_with_stable_order() {
        let names: Vec<_> = tools().into_iter().map(|tool| tool.name).collect();
        assert_eq!(
            names,
            [
                "cogito_knowledge_search",
                "cogito_asset_read",
                "cogito_memory_recall",
                "cogito_memory_write",
                "cogito_asset_visibility_write",
            ]
        );
    }

    #[test]
    fn write_tools_are_exactly_the_two_side_effect_tools() {
        assert_eq!(
            write_tools(),
            &["cogito_memory_write", "cogito_asset_visibility_write"]
        );
    }

    #[test]
    fn ai_worker_name_strips_the_prefix() {
        assert_eq!(
            ai_worker_name("cogito_knowledge_search"),
            Some("knowledge_search")
        );
        assert_eq!(ai_worker_name("knowledge_search"), None);
        assert_eq!(ai_worker_name("cogito_nope"), None);
    }

    #[test]
    fn input_schemas_are_objects_with_required_lists() {
        for tool in tools() {
            assert!(tool.input_schema.is_object());
            assert!(tool.input_schema["type"] == "object");
        }
    }
}
