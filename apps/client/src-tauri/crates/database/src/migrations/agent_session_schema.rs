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
    vec![
        (
            "agent_session",
            "unread",
            r#"ALTER TABLE agent_session ADD COLUMN unread INTEGER NOT NULL DEFAULT 0"#,
        ),
        // ── S9：会话 ↔ ACP 绑定从渲染进程（localStorage）搬进库 ──
        // 以前「刷新后恢复进行中回合」靠 localStorage 里的一张 map，换机器 / 清缓存就没了，
        // 也不受 `agent_tool_audit` 那条「谁调了什么」的追溯约束。现在四列一起落库：
        (
            "agent_session",
            "acpSessionID",
            r#"ALTER TABLE agent_session ADD COLUMN "acpSessionID" TEXT"#,
        ),
        (
            "agent_session",
            "acpCwd",
            r#"ALTER TABLE agent_session ADD COLUMN "acpCwd" TEXT"#,
        ),
        // 已消费到的事件序号：断线重连时告诉 goose 从哪续（可空 = 从未连过）
        (
            "agent_session",
            "lastSeq",
            r#"ALTER TABLE agent_session ADD COLUMN "lastSeq" INTEGER NOT NULL DEFAULT 0"#,
        ),
        // 路由档位（S11 用）：老行一律回填 `local`，即「默认本地优先」
        (
            "agent_session",
            "routeTier",
            r#"ALTER TABLE agent_session ADD COLUMN "routeTier" TEXT NOT NULL DEFAULT 'local'"#,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_are_additive_and_defaulted() {
        let patches = column_patches();
        assert_eq!(patches.len(), 5, "已读状态 1 列 + ACP 绑定 4 列（S9）");
        for (table, _, _) in &patches {
            assert_eq!(*table, "agent_session", "补列都落在 agent_session 上");
        }
        let columns: Vec<&str> = patches.iter().map(|(_, column, _)| *column).collect();
        for expected in ["unread", "acpSessionID", "acpCwd", "lastSeq", "routeTier"] {
            assert!(columns.contains(&expected), "缺 {expected} 这一列");
        }
        for (_, column, sql) in &patches {
            assert!(
                sql.contains("ADD COLUMN"),
                "补列语句必须是 ADD COLUMN：{sql}"
            );
            assert!(
                sql.contains(column),
                "补列语句里的列名要和登记的名字一致：{sql}"
            );
            let upper = sql.to_uppercase();
            assert!(!upper.contains("DROP"), "补列不允许删东西：{sql}");
            assert!(!upper.contains("RENAME"), "补列不允许重建表：{sql}");
        }
        // 两列有值语义（已读 / 序号 / 档位）的一律带默认值：老行不能留空
        for (_, column, sql) in &patches {
            if ["unread", "lastSeq", "routeTier"].contains(column) {
                assert!(
                    sql.contains("NOT NULL DEFAULT"),
                    "{column} 必须给老行回填默认值：{sql}"
                );
            }
        }
    }
}
