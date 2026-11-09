//! `agent_session` 的**老库补列**单源（新增迁移版本为零、0001 基线一个字不动）。
//!
//! 与 `automation_schema` 同一处境：仓库是「单文件 0001 基线」，基线一旦打过标记就不再
//! 执行，所以后加的列光写进 `migrations_0001.rs` 的 `CREATE TABLE IF NOT EXISTS` 只会对新库
//! 生效 —— 老库上仍然是 `no such column`。这里只放 ALTER 语句；
//! `migration::ensure_agent_session()` 先按 `pragma_table_info` 判缺再执行，
//! 因此重复启动无副作用（SQLite 的 `ADD COLUMN` 不幂等，必须靠判定兜住）。
//!
//! 语义约定：
//! - 只 `ADD COLUMN`，不建表 / 不改列类型 / 不删列 / 不重建表 —— 既有行、索引、触发器原样保留；
//! - `unread` 是**阅读状态**，不是会话内容：`0` = 已读（默认），`1` = 这一轮跑完但用户还没打开；
//! - `NOT NULL DEFAULT 0`：老库补列时既有行一律回填成「已读」，不会升级完突然满屏未读点。

/// (表名, 列名, ALTER 语句)。表名 + 列名用于 `pragma_table_info` 判定是否已存在。
pub fn column_patches() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![(
        "agent_session",
        "unread",
        r#"ALTER TABLE agent_session ADD COLUMN unread INTEGER NOT NULL DEFAULT 0"#,
    )]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_are_additive_and_defaulted() {
        let patches = column_patches();
        assert_eq!(patches.len(), 1, "目前只有「已读 / 未读」一列");
        let (table, column, alter) = patches[0];
        assert_eq!(table, "agent_session");
        assert_eq!(column, "unread");
        assert!(
            alter.contains("ALTER TABLE agent_session ADD COLUMN unread"),
            "补列语句必须追在表尾：{alter}"
        );
        assert!(
            alter.contains("NOT NULL DEFAULT 0"),
            "既有的历史会话必须回填成「已读」，否则一升级满屏未读点：{alter}"
        );
        for (_, _, sql) in patches {
            let upper = sql.to_uppercase();
            assert!(!upper.contains("DROP"), "补列不允许删东西：{sql}");
            assert!(!upper.contains("RENAME"), "补列不允许重建表：{sql}");
        }
    }
}
