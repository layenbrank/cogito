//! `agent_tool_audit` 的 DDL 单源（S6 工具审计）。
//!
//! 和 `composer_queue_schema` / `agent_plan_schema` 一样：仓库是「单文件 0001 基线」，
//! 基线打过标记就不再跑，所以新表要两条路都走 —— 进基线（新库 / `migrate:fresh`），
//! 以及 `migration::ensure_tool_audit()` 在每次启动时 `IF NOT EXISTS` 兜底（老库）。
//!
//! 语义约定：
//! - **不落 args 原文**：只存 `argsDigest`（FNV-1a 64），用来判断「是不是同一次调用」，
//!   参数里可能带密钥 / 隐私内容；
//! - `effect` / `risk` 取自 `cogito_core::tools::ToolSpec`，与工具目录同源；
//! - `ok = 0` 时 `error` 存可读字符串（截断到 500 字符），失败调用同样算一条记录；
//! - 保留期 7 天，由启动时的 `audit::prune` 裁剪（不设 TTL 触发器，SQLite 里不划算）。

pub fn statements() -> Vec<&'static str> {
    vec![
        r#"CREATE TABLE IF NOT EXISTS agent_tool_audit (
             id TEXT PRIMARY KEY NOT NULL,
             toolName TEXT NOT NULL,
             effect TEXT NOT NULL,
             risk TEXT NOT NULL,
             ok INTEGER NOT NULL,
             error TEXT,
             argsDigest TEXT NOT NULL,
             durationMs INTEGER NOT NULL,
             "createdAt" INTEGER NOT NULL)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_agent_tool_audit_createdAt
             ON agent_tool_audit ("createdAt")"#,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statements_are_idempotent() {
        let statements = statements();
        assert_eq!(statements.len(), 2, "一表一索引");
        for statement in &statements {
            assert!(
                statement.contains("IF NOT EXISTS"),
                "老库启动兜底会重复执行，必须幂等：{statement}"
            );
        }
    }

    #[test]
    fn columns_cover_audit_payload_without_plaintext_args() {
        let ddl = statements().join("\n");
        for column in [
            "id",
            "toolName",
            "effect",
            "risk",
            "ok",
            "error",
            "argsDigest",
            "durationMs",
            "\"createdAt\"",
        ] {
            assert!(ddl.contains(column), "缺列 {column}");
        }
        assert!(
            !ddl.contains("arguments TEXT"),
            "不能落 args 原文：参数里可能带密钥"
        );
    }
}
