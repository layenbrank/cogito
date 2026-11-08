//! `agent_plan` / `agent_goal` 的 DDL 单源。
//!
//! 为什么单独成文件而不是直接写进 `migrations_0001.rs`：仓库是「单文件 0001 基线」，
//! 基线一旦打过标记就不会再跑，老库里新追加的表永远建不出来。所以同一份语句要
//! 走两条路 —— ① 基线里执行（新库 / `migrate:fresh`）；② `migration::ensure_agent_plan()`
//! 在每次启动时以 `IF NOT EXISTS` 兜底（老库）。
//!
//! 与 `dict_seed` 同一模式：语句全部幂等，重复执行无副作用。

/// 建表 + 索引语句（幂等）。顺序：先表后索引。
pub fn statements() -> Vec<&'static str> {
    vec![
        r#"CREATE TABLE IF NOT EXISTS agent_plan (
             id TEXT PRIMARY KEY NOT NULL,
             sessionID TEXT NOT NULL,
             title TEXT NOT NULL DEFAULT '',
             overview TEXT NOT NULL DEFAULT '',
             steps TEXT NOT NULL DEFAULT '[]',
             body TEXT NOT NULL DEFAULT '',
             status TEXT NOT NULL DEFAULT 'draft',
             source TEXT NOT NULL DEFAULT 'thread',
             "filePath" TEXT NULL,
             revision INTEGER NOT NULL DEFAULT 1,
             digest TEXT NOT NULL DEFAULT '',
             truncated INTEGER NOT NULL DEFAULT 0,
             "createdAt" INTEGER NOT NULL,
             "updatedAt" INTEGER NOT NULL,
             "executedAt" INTEGER NULL,
             "finishedAt" INTEGER NULL,
             "executedRevision" INTEGER NULL,
             "supersededBy" INTEGER NULL)"#,
        r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_plan_sessionID ON agent_plan (sessionID)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_agent_plan_updatedAt ON agent_plan ("updatedAt")"#,
        r#"CREATE TABLE IF NOT EXISTS agent_goal (
             id TEXT PRIMARY KEY NOT NULL,
             sessionID TEXT NOT NULL,
             summary TEXT NOT NULL DEFAULT '',
             detail TEXT NOT NULL DEFAULT '',
             budget INTEGER NOT NULL DEFAULT 6,
             used INTEGER NOT NULL DEFAULT 0,
             "progressDone" INTEGER NULL,
             "progressTotal" INTEGER NULL,
             status TEXT NOT NULL DEFAULT 'running',
             "approvalBefore" TEXT NULL,
             "expectedPrompt" TEXT NULL,
             "leaseRunID" TEXT NULL,
             "leaseUntil" INTEGER NULL,
             "modeBefore" TEXT NULL,
             "createdAt" INTEGER NOT NULL,
             "updatedAt" INTEGER NOT NULL)"#,
        r#"CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_goal_sessionID ON agent_goal (sessionID)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_agent_goal_updatedAt ON agent_goal ("updatedAt")"#,
    ]
}

/// 老库表已存在时补列（`CREATE IF NOT EXISTS` 不会改既有表结构）。
/// 调用方需先按 pragma 判断缺列再执行，避免重复 ADD 报错。
pub fn goal_column_patches() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "expectedPrompt",
            r#"ALTER TABLE agent_goal ADD COLUMN "expectedPrompt" TEXT NULL"#,
        ),
        // 回合租约（单飞凭据）与「启动前的模式」：目标推进收敛到唯一入口之后才需要。
        // 三列都可空，老库 ALTER 不会失败，也不会给已有行编造状态。
        (
            "leaseRunID",
            r#"ALTER TABLE agent_goal ADD COLUMN "leaseRunID" TEXT NULL"#,
        ),
        (
            "leaseUntil",
            r#"ALTER TABLE agent_goal ADD COLUMN "leaseUntil" INTEGER NULL"#,
        ),
        (
            "modeBefore",
            r#"ALTER TABLE agent_goal ADD COLUMN "modeBefore" TEXT NULL"#,
        ),
    ]
}

/// `agent_plan` 老库补列：计划版本化（`executedRevision` / `supersededBy`）是 0001 基线
/// 之后才加的，`CREATE TABLE IF NOT EXISTS` 不会给已有库补列，只能走 ALTER。
pub fn plan_column_patches() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "executedRevision",
            r#"ALTER TABLE agent_plan ADD COLUMN "executedRevision" INTEGER NULL"#,
        ),
        (
            "supersededBy",
            r#"ALTER TABLE agent_plan ADD COLUMN "supersededBy" INTEGER NULL"#,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statements_are_idempotent_and_cover_both_tables() {
        let statements = statements();
        assert!(statements.len() >= 6);
        for statement in &statements {
            assert!(
                statement.contains("IF NOT EXISTS"),
                "DDL 必须幂等（老库启动兜底会重复执行）：{statement}"
            );
        }
        assert!(statements.iter().any(|s| s.contains("agent_plan")));
        assert!(statements.iter().any(|s| s.contains("agent_goal")));
        assert!(
            statements
                .iter()
                .any(|s| s.contains("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_plan_sessionID")),
            "一个会话只允许一份计划：sessionID 必须有唯一索引"
        );
        assert!(
            statements
                .iter()
                .any(|s| s.contains("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_goal_sessionID")),
            "一个会话只允许一个目标：sessionID 必须有唯一索引"
        );
    }
}
