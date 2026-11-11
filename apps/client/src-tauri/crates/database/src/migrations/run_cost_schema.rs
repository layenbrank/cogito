//! 成本账本 DDL 单源（S8）。
//!
//! 为什么不给 `agent_usage` 加列、而是单独一张 `agent_run_cost`：
//!
//! - `agent_usage` 是「用量」，前端会 `toUpdate` 拿累计值改写它；账本是**账**，
//!   落一行就不再改（改价、改算法都只影响之后的行）。
//! - 账本是**派生**数据：一轮 turn 结束、写 usage 的同一处算出价格落一行。
//!   usage 表删了，账本仍然留着（这也是「花了多少钱」能对得上的前提）。
//! - 只存结论不存原料：`inputTokens` / `outputTokens` 是数字，**不存** prompt /
//!   回复正文 —— 账本没有理由复制用户的对话内容。
//!
//! `priceMicros` / `currency` 允许 NULL：未知模型记「未计价」，**不猜价**。
//! 金额单位是「微元」（1 元 = 1_000_000 微元），整数存储，规避浮点误差。

/// 建表 + 索引：全部 `IF NOT EXISTS`，新库（0001 基线）与老库（启动兜底）
/// 共用同一份语句，跑多少遍都一样。
const STATEMENTS: [&str; 3] = [
    r#"CREATE TABLE IF NOT EXISTS agent_run_cost (
         id TEXT PRIMARY KEY NOT NULL,
         "usageID" TEXT NOT NULL,
         "runID" TEXT,
         "sessionID" TEXT,
         model TEXT NOT NULL,
         "inputTokens" INTEGER NOT NULL,
         "outputTokens" INTEGER NOT NULL,
         "priceMicros" INTEGER,
         currency TEXT,
         "dayKey" TEXT NOT NULL,
         "createdAt" INTEGER NOT NULL
       )"#,
    r#"CREATE INDEX IF NOT EXISTS idx_agent_run_cost_createdAt ON agent_run_cost ("createdAt")"#,
    r#"CREATE INDEX IF NOT EXISTS idx_agent_run_cost_dayKey ON agent_run_cost ("dayKey")"#,
];

#[must_use]
pub fn statements() -> [&'static str; 3] {
    STATEMENTS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ddl() -> String {
        statements().join("\n")
    }

    #[test]
    fn create_statements_are_idempotent() {
        for statement in statements() {
            assert!(
                statement.contains("IF NOT EXISTS"),
                "迁移会重复执行，缺 IF NOT EXISTS：{statement}"
            );
        }
    }

    #[test]
    fn stores_tokens_and_price_but_no_prompt_text() {
        let ddl = ddl();
        for column in ["inputTokens", "outputTokens", "priceMicros", "currency"] {
            assert!(ddl.contains(column), "缺列 {column}");
        }
        for column in ["dayKey", "usageID", "sessionID"] {
            assert!(ddl.contains(column), "缺列 {column}");
        }
        // 账本只记数字与模型名，不许出现承载对话正文的列
        // （不能笼统查 "text" —— 那是列类型；这里查的是可能承载正文的列名）
        let lower = ddl.to_lowercase();
        for forbidden in ["prompt", "content", "message"] {
            assert!(
                !lower.contains(forbidden),
                "账本表里不该出现 {forbidden} 列"
            );
        }
    }

    #[test]
    fn price_columns_are_nullable() {
        let ddl = ddl();
        // 未知模型要能落 NULL（未计价），所以这两列不能带 NOT NULL
        for (i, line) in ddl.lines().enumerate() {
            let trimmed = line.trim();
            for column in ["\"priceMicros\"", "currency"] {
                if trimmed.starts_with(column) {
                    assert!(
                        !trimmed.contains("NOT NULL"),
                        "第 {} 行的 {column} 不允许 NOT NULL：{trimmed}",
                        i + 1
                    );
                }
            }
        }
    }
}
