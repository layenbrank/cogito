//! `agent_composer_queue` 的 DDL 单源。
//!
//! 为什么单独成文件而不是直接写进 `migrations_0001.rs`：仓库是「单文件 0001 基线」，
//! 基线一旦打过标记就不会再跑，老库里新追加的表永远建不出来。所以同一份语句要
//! 走两条路 —— ① 基线里执行（新库 / `migrate:fresh`）；② `migration::ensure_composer_queue()`
//! 在每次启动时以 `IF NOT EXISTS` 兜底（老库）。
//!
//! 语义约定：
//! - 这是**独立新表**，不透支 `agent_session`：零 `ALTER`、不改在用表；
//! - `lane` 只有 `main`（排队）与 `steer`（立即发）两种，顺序由 `sort` 决定；
//! - `text` 是 chip 已 `@` 序列化后的线格式文本，与 `composer-document.serializeDocument`
//!   的输出一致，读回来可直接 `parseDocument`；
//! - `attachments` 是 JSON 数组字符串，与 runtime 的附件负载同形；
//! - 会话删除时级联清理（外键 `ON DELETE CASCADE`，SQLite 需 `PRAGMA foreign_keys=ON`）。

/// 建表 + 索引语句（幂等）。顺序：先表后索引。
pub fn statements() -> Vec<&'static str> {
    vec![
        r#"CREATE TABLE IF NOT EXISTS agent_composer_queue (
             id TEXT PRIMARY KEY NOT NULL,
             sessionID TEXT NOT NULL,
             lane TEXT NOT NULL DEFAULT 'main',
             sort INTEGER NOT NULL DEFAULT 0,
             text TEXT NOT NULL,
             attachments TEXT NOT NULL DEFAULT '[]',
             "createdAt" INTEGER NOT NULL,
             "updatedAt" INTEGER NOT NULL,
             FOREIGN KEY (sessionID) REFERENCES agent_session (id) ON DELETE CASCADE)"#,
        r#"CREATE INDEX IF NOT EXISTS idx_agent_composer_queue_sessionID
             ON agent_composer_queue (sessionID, lane, sort)"#,
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
                "DDL 必须幂等（老库启动兜底会重复执行）：{statement}"
            );
        }
        assert!(
            statements
                .iter()
                .any(|s| s.contains("CREATE TABLE IF NOT EXISTS agent_composer_queue"))
        );
        assert!(
            statements.iter().any(
                |s| s.contains("CREATE INDEX IF NOT EXISTS idx_agent_composer_queue_sessionID")
            )
        );
    }

    #[test]
    fn columns_cover_queue_payload() {
        let ddl = statements().join("\n");
        for column in [
            "id",
            "sessionID",
            "lane",
            "sort",
            "text",
            "attachments",
            "\"createdAt\"",
            "\"updatedAt\"",
        ] {
            assert!(ddl.contains(column), "缺列 {column}");
        }
        assert!(
            ddl.contains("ON DELETE CASCADE"),
            "会话删除必须级联清理队列，否则留下孤儿行"
        );
    }
}
