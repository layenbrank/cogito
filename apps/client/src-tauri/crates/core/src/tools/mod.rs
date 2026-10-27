//! Agent 本地工具面（`app_*`）：目录与实现只在这里定义一次。
//!
//! 两条消费者：app 内 loopback 桥（`bridge::http`，`cogito-mcp` 经它调用）与
//! 前端审批/标签（按名字判断效果）。加工具只改本模块，桥与侧车都自动跟上。
//!
//! 边界：这里**只读**；写工具（Phase 5 的 knowledge staging）同样在此注册，
//! 并且必须由 app 侧执行，保持「app 是数据库唯一写者」。
pub mod calendar;
pub mod workspace;

use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 工具效果：与 `features/agent/approval.ts` 的读/写分类同一语义。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effect {
    Read,
    Write,
}

/// 一个工具的对外描述（`GET /internal/tools/list` 与 MCP `tools/list` 同源）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    /// JSON Schema（MCP 的 `inputSchema`）
    pub input_schema: Value,
    pub effect: Effect,
}

fn describe(name: &str, description: &str, effect: Effect, input_schema: Value) -> ToolSpec {
    ToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema,
        effect,
    }
}

/// 工具目录：只读工具先落地，Phase 5 会在这里追加 `app_knowledge_*`。
#[must_use]
pub fn catalog() -> Vec<ToolSpec> {
    let mut tools = vec![calendar::spec()];
    tools.extend(workspace::specs());
    tools
}

/// 按名字分发。参数非法或执行失败都返回可读字符串，由调用方决定呈现方式。
pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    if name == calendar::NAME {
        return calendar::call(db, arguments).await;
    }
    if workspace::owns(name) {
        return workspace::call(db, name, arguments).await;
    }
    Err(format!("未知工具：{name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_exposes_read_only_tools() {
        let tools = catalog();
        let names: Vec<&str> = tools.iter().map(|tool| tool.name.as_str()).collect();
        assert!(names.contains(&calendar::NAME));
        assert!(names.contains(&workspace::LIST));
        assert!(names.contains(&workspace::READ));
        for tool in &tools {
            assert_eq!(tool.effect, Effect::Read, "{} 应为只读", tool.name);
            assert_eq!(
                tool.input_schema.get("type").and_then(Value::as_str),
                Some("object"),
                "{} 的 inputSchema 必须是 object",
                tool.name
            );
        }
    }

    #[tokio::test]
    async fn unknown_tool_is_rejected() {
        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        let error = call(&db, "app_nope", &Value::Null)
            .await
            .expect_err("未知工具应报错");
        assert!(error.contains("app_nope"));
    }
}
