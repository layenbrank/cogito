//! `automation` 的**老库补列**单源。
//!
//! 与 `agent_plan_schema` 同一处境：仓库是「单文件 0001 基线」，基线一旦打过标记就不再
//! 执行，所以后加的列光写进 `migrations_0001.rs` 的 `CREATE TABLE IF NOT EXISTS` 只会
//! 对新库生效 —— 老库上仍然是 `no such column: workspaceId`。
//!
//! 这里只放 ALTER 语句；`migration::ensure_automation()` 先按 `pragma_table_info` 判缺
//! 再执行，因此重复启动无副作用（SQLite 的 `ADD COLUMN` 不幂等，必须靠判定兜住）。
//!
//! 两列都要给默认值：`approval` 必须是 `NOT NULL DEFAULT 'readonly'` —— 老任务在加列
//! 前都是「无人值守 + 只读」的语义，升级后行为不能变。

/// (列名, ALTER 语句)。列名用于 `pragma_table_info` 判定是否已存在。
pub fn column_patches() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "workspaceId",
            r#"ALTER TABLE automation ADD COLUMN "workspaceId" TEXT NULL"#,
        ),
        (
            "approval",
            r#"ALTER TABLE automation ADD COLUMN approval TEXT NOT NULL DEFAULT 'readonly'"#,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_are_alter_on_automation() {
        let patches = column_patches();
        assert_eq!(patches.len(), 2, "两列各一条 ALTER");
        for (column, statement) in &patches {
            assert!(
                statement.starts_with("ALTER TABLE automation ADD COLUMN"),
                "只允许给 automation 补列：{statement}"
            );
            assert!(
                statement.contains(&format!("\"{column}\"")) || statement.contains(column),
                "语句与列名要对得上：{column} / {statement}"
            );
        }
        // 老任务升级后默认只读：不允许出现「默认放开写权限」的补列
        assert!(patches
            .iter()
            .any(|(column, statement)| *column == "approval"
                && statement.contains("DEFAULT 'readonly'")));
    }
}
