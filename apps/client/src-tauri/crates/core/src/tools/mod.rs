//! Agent 本地工具面（`app_*`）：目录与实现只在这里定义一次。
//!
//! 两条消费者：app 内 loopback 桥（`bridge::http`，`cogito-mcp` 经它调用）与
//! 前端审批/标签（按名字判断效果）。加工具只改本模块，桥与侧车都自动跟上。
//!
//! 边界：这里**只读**；写工具（Phase 5 的 knowledge staging）同样在此注册，
//! 并且必须由 app 侧执行，保持「app 是数据库唯一写者」。
pub mod browser;
pub mod calendar;
pub mod knowledge;
pub mod terminal;
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
    tools.extend(knowledge::specs());
    tools.extend(browser::specs());
    tools.extend(terminal::specs());
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
    if knowledge::owns(name) {
        return knowledge::call(db, name, arguments).await;
    }
    if browser::owns(name) || terminal::owns(name) {
        // 浏览器工具要访问 webview、终端工具要访问 PTY 会话，都只能由 app 侧执行；
        // 走到这里说明桥没有拦截（例如直接调 `tools::call` 的单测），
        // 给一句能看懂的说明而不是“未知工具”。
        return Err(format!("{name} 需要宿主窗口，只能在 app 内执行"));
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
        assert!(names.contains(&knowledge::LIST_BASES));
        assert!(names.contains(&knowledge::LIST_DOCS));
        assert!(names.contains(&knowledge::READ_DOC));
        assert!(names.contains(&knowledge::SEARCH));
        assert!(names.contains(&knowledge::WRITE_DOC));
        assert!(names.contains(&browser::OPEN));
        assert!(names.contains(&browser::READ));
        assert!(names.contains(&browser::ACT));
        assert!(names.contains(&browser::SCREENSHOT));
        assert!(names.contains(&terminal::RUN));
        assert!(names.contains(&terminal::READ));
        assert!(names.contains(&terminal::LIST));
        // 有副作用的工具必须显式列在这里，其余一律只读
        let write_tools = [
            knowledge::WRITE_DOC,
            browser::ACT,
            browser::INTERCEPT,
            terminal::RUN,
        ];
        for tool in &tools {
            let expected = if write_tools.contains(&tool.name.as_str()) {
                Effect::Write
            } else {
                Effect::Read
            };
            assert_eq!(tool.effect, expected, "{} 的效果标错了", tool.name);
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
