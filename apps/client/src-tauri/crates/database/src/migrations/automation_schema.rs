//! `automation` / `automation_run` 的**老库补列**单源。
//!
//! 与 `agent_plan_schema` 同一处境：仓库是「单文件 0001 基线」，基线一旦打过标记就不再
//! 执行，所以后加的列光写进 `migrations_0001.rs` 的 `CREATE TABLE IF NOT EXISTS` 只会
//! 对新库生效 —— 老库上仍然是 `no such column`。
//!
//! 这里只放 ALTER 语句；`migration::ensure_automation()` 先按 `pragma_table_info` 判缺
//! 再执行，因此重复启动无副作用（SQLite 的 `ADD COLUMN` 不幂等，必须靠判定兜住）。
//!
//! `approval` 的默认值必须是 `NOT NULL DEFAULT 'readonly'` —— 老任务在加列
//! 前都是「无人值守 + 只读」的语义，升级后行为不能变。

/// (表名, 列名, ALTER 语句)。表名+列名用于 `pragma_table_info` 判定是否已存在。
pub fn column_patches() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        (
            "automation",
            "workspaceId",
            r#"ALTER TABLE automation ADD COLUMN "workspaceId" TEXT NULL"#,
        ),
        (
            "automation",
            "workspacePath",
            r#"ALTER TABLE automation ADD COLUMN "workspacePath" TEXT NULL"#,
        ),
        (
            "automation",
            "sessionMode",
            r#"ALTER TABLE automation ADD COLUMN "sessionMode" TEXT NOT NULL DEFAULT 'new'"#,
        ),
        (
            "automation",
            "sessionId",
            r#"ALTER TABLE automation ADD COLUMN "sessionId" TEXT NULL"#,
        ),
        (
            "automation",
            "approval",
            r#"ALTER TABLE automation ADD COLUMN approval TEXT NOT NULL DEFAULT 'readonly'"#,
        ),
        (
            "automation",
            "providerId",
            r#"ALTER TABLE automation ADD COLUMN "providerId" TEXT NULL"#,
        ),
        (
            "automation",
            "modelId",
            r#"ALTER TABLE automation ADD COLUMN "modelId" TEXT NULL"#,
        ),
        (
            "automation",
            "mode",
            r#"ALTER TABLE automation ADD COLUMN mode TEXT NOT NULL DEFAULT 'agent'"#,
        ),
        (
            "automation",
            "goalBudget",
            r#"ALTER TABLE automation ADD COLUMN "goalBudget" INTEGER NOT NULL DEFAULT 6"#,
        ),
        (
            "automation",
            "planThenGoal",
            r#"ALTER TABLE automation ADD COLUMN "planThenGoal" INTEGER NOT NULL DEFAULT 0"#,
        ),
        (
            "automation",
            "planFilePath",
            r#"ALTER TABLE automation ADD COLUMN "planFilePath" TEXT NULL"#,
        ),
        (
            "automation_run",
            "sessionId",
            r#"ALTER TABLE automation_run ADD COLUMN "sessionId" TEXT NULL"#,
        ),
        (
            "automation_run",
            "phase",
            r#"ALTER TABLE automation_run ADD COLUMN phase TEXT NULL"#,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_are_alter_on_automation_tables() {
        let patches = column_patches();
        assert!(patches.len() >= 7, "至少覆盖执行配置 + 模式/模型 + run 回链");
        for (table, column, statement) in &patches {
            assert!(
                statement.starts_with(&format!("ALTER TABLE {table} ADD COLUMN")),
                "只允许给 automation 表族补列：{statement}"
            );
            assert!(
                statement.contains(&format!("\"{column}\"")) || statement.contains(column),
                "语句与列名要对得上：{column} / {statement}"
            );
        }
        // 老任务升级后默认只读：不允许出现「默认放开写权限」的补列
        assert!(patches
            .iter()
            .any(|(_, column, statement)| *column == "approval"
                && statement.contains("DEFAULT 'readonly'")));
        assert!(patches
            .iter()
            .any(|(_, column, statement)| *column == "mode"
                && statement.contains("DEFAULT 'agent'")));
    }
}
