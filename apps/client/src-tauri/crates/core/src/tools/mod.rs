//! Agent 本地工具面（`app_*`）：目录与实现只在这里定义一次。
//!
//! 两条消费者：app 内 loopback 桥（`bridge::http`，`cogito-mcp` 经它调用）与
//! 前端审批/标签（按名字判断效果）。加工具只改本模块，桥与侧车都自动跟上。
//!
//! 边界：写工具必须由 app 侧执行（保持「app 是数据库唯一写者」）；Agent 的文件写入
//! 只允许经 `app_workspace_write` / `app_workspace_patch`，goose 内置文件工具在审批层禁用。
pub mod agents;
pub mod audit;
pub mod browser;
pub mod calendar;
pub mod code;
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

/// 风险级别：`Guarded` = 写工具，但可能触及受保护路径（`.env` / `*.pem`），
/// 需要「按参数」再判一次（见 `workspace::guard_for`）。
///
/// 只走 `/internal/tools/list` 的内部字段，**不进** MCP 的 `inputSchema`
/// —— 不改 Agent 可见的调用契约。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Risk {
    #[default]
    Read,
    Write,
    Guarded,
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
    /// 风险级别（内部字段，MCP 侧会忽略）
    #[serde(default)]
    pub risk: Risk,
}

fn describe(name: &str, description: &str, effect: Effect, input_schema: Value) -> ToolSpec {
    let risk = match effect {
        Effect::Read => Risk::Read,
        Effect::Write => Risk::Write,
    };
    describe_with_risk(name, description, effect, risk, input_schema)
}

fn describe_with_risk(
    name: &str,
    description: &str,
    effect: Effect,
    risk: Risk,
    input_schema: Value,
) -> ToolSpec {
    ToolSpec {
        name: name.to_string(),
        description: description.to_string(),
        input_schema,
        effect,
        risk,
    }
}

/// 工具目录：只读工具 + 写工具（知识库 / 浏览器 / 终端 / 工作区写入）。
#[must_use]
pub fn catalog() -> Vec<ToolSpec> {
    let mut tools = vec![calendar::spec()];
    tools.extend(workspace::specs());
    tools.extend(knowledge::specs());
    tools.extend(code::specs());
    tools.extend(browser::specs());
    tools.extend(terminal::specs());
    tools.extend(agents::specs());
    tools
}

/// 按名字分发。参数非法或执行失败都返回可读字符串，由调用方决定呈现方式。
///
/// 这里同时是**审计点**（S6）：成功与失败各落一行 `agent_tool_audit`。审计自
/// 身失败只打日志 —— 它是旁路，不能把一次正常调用变成错误。
pub async fn call(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    let started = std::time::Instant::now();
    let result = dispatch(db, name, arguments).await;
    let duration_ms = i64::try_from(started.elapsed().as_millis()).unwrap_or(i64::MAX);
    let error = result.as_ref().err().map(String::as_str);
    if let Err(failure) =
        audit::record(db, name, error.is_none(), error, arguments, duration_ms).await
    {
        tracing::warn!("工具审计写入失败：{failure}");
    }
    result
}

/// 真正的分发表：加工具只改这里（以及各实现模块的 `spec` / `owns`）。
async fn dispatch(db: &DatabaseConnection, name: &str, arguments: &Value) -> Result<Value, String> {
    if name == calendar::NAME {
        return calendar::call(db, arguments).await;
    }
    if workspace::owns(name) {
        return workspace::call(db, name, arguments).await;
    }
    if knowledge::owns(name) {
        return knowledge::call(db, name, arguments).await;
    }
    if code::owns(name) {
        return code::call(db, name, arguments).await;
    }
    if browser::owns(name) || terminal::owns(name) || agents::owns(name) {
        // 浏览器工具要访问 webview、终端工具要访问 PTY 会话、子 agent 要把活派给
        // 渲染进程（ACP 连接在那边），都只能由 app 侧执行；
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
        assert!(names.contains(&workspace::WRITE));
        assert!(names.contains(&workspace::PATCH));
        assert!(names.contains(&knowledge::LIST_BASES));
        assert!(names.contains(&knowledge::LIST_DOCS));
        assert!(names.contains(&knowledge::READ_DOC));
        assert!(names.contains(&knowledge::READ_WIKI));
        assert!(names.contains(&knowledge::SEARCH));
        assert!(names.contains(&knowledge::LINT));
        assert!(names.contains(&knowledge::INGEST));
        assert!(names.contains(&knowledge::WRITE_DOC));
        assert!(names.contains(&knowledge::GRAPH_SEARCH));
        assert!(names.contains(&code::SYMBOLS));
        assert!(names.contains(&code::OUTLINE));
        assert!(names.contains(&code::REFS));
        assert!(names.contains(&code::IMPACT));
        assert!(names.contains(&code::SEARCH));
        assert!(names.contains(&knowledge::WORKSPACE_WRITE));
        assert!(names.contains(&browser::OPEN));
        assert!(names.contains(&browser::READ));
        assert!(names.contains(&browser::ACT));
        assert!(names.contains(&browser::SCREENSHOT));
        assert!(names.contains(&browser::DEVICE));
        assert!(names.contains(&terminal::RUN));
        assert!(names.contains(&terminal::READ));
        assert!(names.contains(&terminal::LIST));
        assert!(names.contains(&agents::SPAWN));
        assert!(names.contains(&agents::WAIT));
        assert!(names.contains(&agents::RESULT));
        // 有副作用的工具必须显式列在这里，其余一律只读
        let write_tools = [
            knowledge::WRITE_DOC,
            knowledge::INGEST,
            knowledge::WORKSPACE_WRITE,
            browser::ACT,
            browser::INTERCEPT,
            browser::DEVICE,
            terminal::RUN,
            terminal::WRITE,
            workspace::WRITE,
            workspace::PATCH,
            agents::SPAWN,
        ];
        // 可能触及受保护路径的写工具：前端要按参数再判一次
        let guarded_tools = [workspace::WRITE, workspace::PATCH];
        for tool in &tools {
            let expected = if write_tools.contains(&tool.name.as_str()) {
                Effect::Write
            } else {
                Effect::Read
            };
            assert_eq!(tool.effect, expected, "{} 的效果标错了", tool.name);
            let expected_risk = if guarded_tools.contains(&tool.name.as_str()) {
                Risk::Guarded
            } else if expected == Effect::Write {
                Risk::Write
            } else {
                Risk::Read
            };
            assert_eq!(tool.risk, expected_risk, "{} 的风险档标错了", tool.name);
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

    /// 审计旁路（S6）：即使工具不存在，也要留下「谁被调用了、失败了」的痕迹
    #[tokio::test]
    async fn call_writes_audit_row_for_unknown_tool() {
        let db = sea_orm::Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        assert!(call(&db, "app_nope", &Value::Null).await.is_err());
        let rows = audit::recent(&db, 10).await.expect("读审计");
        assert_eq!(rows.len(), 1, "一次调用一行");
        assert_eq!(rows[0].tool_name, "app_nope");
        assert!(!rows[0].ok);
        assert_eq!(rows[0].effect, "unknown");
    }
}
