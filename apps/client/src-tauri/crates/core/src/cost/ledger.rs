//! 成本账本（S8）：把「这一轮花了多少钱」落成一行。
//!
//! 写入点只有一个 —— `agent_usage::Service::write_one`（用量与账本同一条路径，
//! 所以不会出现「有用量没账」）。写法遵循 S6 审计的两条约定：
//!
//! - **旁路不是闸门**：写账失败只 `tracing::warn`，绝不让一次正常的用量写入失败；
//! - **自愈**：老库 / 单测内存库没跑过 migration 时，撞上「no such table」补建一次再重试。
//!
//! 与审计不同的是保留期：审计 7 天（调试用），账本留 400 天（对着账单看一年的量）。
//! 表结构单源在 `cogito_database::migrations::run_cost_schema`。

use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::Serialize;

use super::pricing;

/// 保留窗口：400 天（跨一年对账够用，又不会无限长）。
pub const RETENTION_MS: i64 = 400 * 24 * 60 * 60 * 1000;

/// 单次导出上限：诊断页只做肉眼核对，几万行也不是给人看的。
pub const EXPORT_LIMIT: u32 = 5_000;

/// 待落账的一轮用量（`price` 由 `record` 内部算，调用方不传价格）。
#[derive(Debug, Clone)]
pub struct Draft {
    pub usage_id: String,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub created_at: i64,
}

/// 账本一行（导出给前端的形状，camelCase 与其它 IPC 一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub usage_id: String,
    pub run_id: Option<String>,
    pub session_id: Option<String>,
    pub model: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// 微元；`None` = 未计价（未知模型）
    pub price_micros: Option<i64>,
    /// 币种；未计价时同样是 `None`
    pub currency: Option<String>,
    /// `YYYY-MM-DD`（UTC）：按天汇总用，避免每次都去解析时间戳
    pub day_key: String,
    pub created_at: i64,
}

/// 保留期内的汇总（导出页头部的几个数字）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub runs: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    /// 已计价部分的微元合计（未计价的那些不计入，单独用 `unpriced_runs` 说明）
    pub price_micros: i64,
    pub priced_runs: i64,
    pub unpriced_runs: i64,
}

/// 当前时间（毫秒）。测试里用显式时间戳绕过。
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

/// `YYYY-MM-DD`（UTC）。越界时间戳落 `1970-01-01`，不 panic。
#[must_use]
pub fn day_key(ms: i64) -> String {
    chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms)
        .map(|at| at.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "1970-01-01".to_string())
}

/// 记一轮成本。返回值只给调用方打日志用 —— **不要**把它变成写入失败。
pub async fn record<C>(db: &C, draft: Draft) -> Result<String, String>
where
    C: ConnectionTrait + ?Sized,
{
    let id = uuid::Uuid::new_v4().to_string();
    let priced = pricing::price(&draft.model, draft.input_tokens, draft.output_tokens);
    let price_micros = priced.map(|price| price.price_micros);
    let currency = priced.map(|price| price.currency);
    let key = day_key(draft.created_at);

    let attempt = insert_once(db, &id, &draft, price_micros, currency, &key).await;
    match attempt {
        Ok(()) => Ok(id),
        // 老库 / 单测内存库没跑过 migration：补建一次再重试（语句幂等）
        Err(_) => {
            ensure_table(db).await?;
            insert_once(db, &id, &draft, price_micros, currency, &key).await?;
            Ok(id)
        }
    }
}

async fn insert_once<C>(
    db: &C,
    id: &str,
    draft: &Draft,
    price_micros: Option<i64>,
    currency: Option<&'static str>,
    day_key: &str,
) -> Result<(), String>
where
    C: ConnectionTrait + ?Sized,
{
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"INSERT INTO agent_run_cost
             (id, "usageID", "runID", "sessionID", model, "inputTokens", "outputTokens",
              "priceMicros", currency, "dayKey", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        [
            id.into(),
            draft.usage_id.clone().into(),
            draft.run_id.clone().into(),
            draft.session_id.clone().into(),
            draft.model.clone().into(),
            draft.input_tokens.into(),
            draft.output_tokens.into(),
            price_micros.into(),
            currency.into(),
            day_key.into(),
            draft.created_at.into(),
        ],
    );
    db.execute(statement)
        .await
        .map(|_| ())
        .map_err(|error| format!("写成本账本失败：{error}"))
}

async fn ensure_table<C>(db: &C) -> Result<(), String>
where
    C: ConnectionTrait + ?Sized,
{
    for statement in cogito_database::migrations::run_cost_schema::statements() {
        db.execute_unprepared(statement)
            .await
            .map_err(|error| format!("补建成本账本表失败：{error}"))?;
    }
    Ok(())
}

/// 清掉超过保留期的行（启动时调一次；失败不阻塞启动）。
pub async fn prune<C>(db: &C, now: i64) -> Result<u64, String>
where
    C: ConnectionTrait + ?Sized,
{
    let cutoff = now - RETENTION_MS;
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"DELETE FROM agent_run_cost WHERE "createdAt" < ?"#,
        [cutoff.into()],
    );
    match db.execute(statement).await {
        Ok(result) => Ok(result.rows_affected()),
        // 表还没建：没什么可裁的
        Err(_) => Ok(0),
    }
}

/// 最近 `limit` 条（新的在前）。`limit` 夹到 `EXPORT_LIMIT`。
pub async fn recent<C>(db: &C, limit: u32) -> Result<Vec<Entry>, String>
where
    C: ConnectionTrait + ?Sized,
{
    let limit = limit.min(EXPORT_LIMIT);
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"SELECT id, "usageID", "runID", "sessionID", model, "inputTokens", "outputTokens",
                  "priceMicros", currency, "dayKey", "createdAt"
             FROM agent_run_cost
            ORDER BY "createdAt" DESC
            LIMIT ?"#,
        [i64::from(limit).into()],
    );
    let rows = db
        .query_all(statement)
        .await
        .map_err(|error| format!("读成本账本失败：{error}"))?;
    rows.iter()
        .map(|row| {
            let label =
                |column: &str, error: sea_orm::DbErr| format!("读成本账本 {column} 失败：{error}");
            Ok(Entry {
                id: row
                    .try_get::<String>("", "id")
                    .map_err(|e| label("id", e))?,
                usage_id: row
                    .try_get::<String>("", "usageID")
                    .map_err(|e| label("usageID", e))?,
                run_id: row
                    .try_get::<Option<String>>("", "runID")
                    .map_err(|e| label("runID", e))?,
                session_id: row
                    .try_get::<Option<String>>("", "sessionID")
                    .map_err(|e| label("sessionID", e))?,
                model: row
                    .try_get::<String>("", "model")
                    .map_err(|e| label("model", e))?,
                input_tokens: row
                    .try_get::<i64>("", "inputTokens")
                    .map_err(|e| label("inputTokens", e))?,
                output_tokens: row
                    .try_get::<i64>("", "outputTokens")
                    .map_err(|e| label("outputTokens", e))?,
                price_micros: row
                    .try_get::<Option<i64>>("", "priceMicros")
                    .map_err(|e| label("priceMicros", e))?,
                currency: row
                    .try_get::<Option<String>>("", "currency")
                    .map_err(|e| label("currency", e))?,
                day_key: row
                    .try_get::<String>("", "dayKey")
                    .map_err(|e| label("dayKey", e))?,
                created_at: row
                    .try_get::<i64>("", "createdAt")
                    .map_err(|e| label("createdAt", e))?,
            })
        })
        .collect()
}

/// 保留期内的总条数。
pub async fn count<C>(db: &C) -> Result<i64, String>
where
    C: ConnectionTrait + ?Sized,
{
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"SELECT COUNT(*) AS total FROM agent_run_cost"#,
        Vec::<sea_orm::Value>::new(),
    );
    let row = db
        .query_one(statement)
        .await
        .map_err(|error| format!("读成本账本总数失败：{error}"))?
        .ok_or_else(|| "成本账本总数为空".to_string())?;
    row.try_get::<i64>("", "total")
        .map_err(|error| format!("读成本账本总数失败：{error}"))
}

/// 保留期内的汇总（微元合计 / 计价条数 / 未计价条数）。
pub async fn totals<C>(db: &C) -> Result<Totals, String>
where
    C: ConnectionTrait + ?Sized,
{
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"SELECT COUNT(*)                                        AS runs,
                  COALESCE(SUM("inputTokens"), 0)                 AS input_tokens,
                  COALESCE(SUM("outputTokens"), 0)                AS output_tokens,
                  COALESCE(SUM("priceMicros"), 0)                 AS price_micros,
                  COALESCE(SUM(CASE WHEN "priceMicros" IS NULL THEN 0 ELSE 1 END), 0) AS priced_runs,
                  COALESCE(SUM(CASE WHEN "priceMicros" IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_runs
             FROM agent_run_cost"#,
        Vec::<sea_orm::Value>::new(),
    );
    let row = db
        .query_one(statement)
        .await
        .map_err(|error| format!("读成本账本汇总失败：{error}"))?
        .ok_or_else(|| "成本账本汇总为空".to_string())?;
    let read = |column: &str| {
        row.try_get::<i64>("", column)
            .map_err(|error| format!("读成本账本 {column} 失败：{error}"))
    };
    Ok(Totals {
        runs: read("runs")?,
        input_tokens: read("input_tokens")?,
        output_tokens: read("output_tokens")?,
        price_micros: read("price_micros")?,
        priced_runs: read("priced_runs")?,
        unpriced_runs: read("unpriced_runs")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Database;

    async fn test_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        ensure_table(&db).await.expect("建成本账本表");
        db
    }

    fn draft(model: &str, input: i64, output: i64, at: i64) -> Draft {
        Draft {
            usage_id: format!("usage-{at}"),
            run_id: Some("run-1".to_string()),
            session_id: Some("session-1".to_string()),
            model: model.to_string(),
            input_tokens: input,
            output_tokens: output,
            created_at: at,
        }
    }

    #[tokio::test]
    async fn known_model_lands_price_and_day_key() {
        let db = test_db().await;
        let at = 1_760_000_000_000;
        record(&db, draft("deepseek-chat", 1_000_000, 0, at))
            .await
            .expect("落账");
        let rows = recent(&db, 10).await.expect("读账");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].price_micros, Some(2_000_000));
        assert_eq!(rows[0].currency.as_deref(), Some("CNY"));
        assert_eq!(rows[0].day_key, day_key(at));
        assert_eq!(rows[0].session_id.as_deref(), Some("session-1"));
        assert_eq!(rows[0].usage_id, format!("usage-{at}"));
    }

    #[tokio::test]
    async fn unknown_model_lands_null_price() {
        let db = test_db().await;
        record(&db, draft("mystery-model", 1_000, 1_000, 1))
            .await
            .expect("落账");
        let rows = recent(&db, 10).await.expect("读账");
        assert_eq!(rows[0].price_micros, None, "未知模型不许猜价");
        assert_eq!(rows[0].currency, None);
        let totals = totals(&db).await.expect("汇总");
        assert_eq!(totals.unpriced_runs, 1);
        assert_eq!(totals.priced_runs, 0);
        assert_eq!(totals.price_micros, 0);
    }

    #[tokio::test]
    async fn totals_sum_priced_rows_only() {
        let db = test_db().await;
        record(&db, draft("deepseek-chat", 1_000_000, 0, 10))
            .await
            .expect("落账");
        record(&db, draft("deepseek-chat", 0, 1_000_000, 20))
            .await
            .expect("落账");
        record(&db, draft("mystery-model", 10, 10, 30))
            .await
            .expect("落账");
        let totals = totals(&db).await.expect("汇总");
        assert_eq!(totals.runs, 3);
        assert_eq!(totals.input_tokens, 1_000_010);
        assert_eq!(totals.output_tokens, 1_000_010);
        // 2 元 + 8 元；未计价那条不计入金额
        assert_eq!(totals.price_micros, 10_000_000);
        assert_eq!(totals.priced_runs, 2);
        assert_eq!(totals.unpriced_runs, 1);
        assert_eq!(count(&db).await.expect("总数"), 3);
    }

    #[tokio::test]
    async fn recent_is_newest_first_and_limited() {
        let db = test_db().await;
        for at in [10_i64, 20, 30] {
            record(&db, draft("deepseek-chat", 1, 1, at))
                .await
                .expect("落账");
        }
        let rows = recent(&db, 2).await.expect("读账");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].created_at, 30, "新的在前");
        assert_eq!(rows[1].created_at, 20);
    }

    #[tokio::test]
    async fn prune_drops_rows_outside_retention() {
        let db = test_db().await;
        let now = 1_760_000_000_000;
        record(&db, draft("deepseek-chat", 1, 1, now - RETENTION_MS - 1))
            .await
            .expect("旧账");
        record(&db, draft("deepseek-chat", 1, 1, now))
            .await
            .expect("新账");
        let dropped = prune(&db, now).await.expect("裁剪");
        assert_eq!(dropped, 1);
        assert_eq!(count(&db).await.expect("总数"), 1);
    }

    #[tokio::test]
    async fn record_self_heals_missing_table() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        // 没建表直接写：应当补建后成功
        record(&db, draft("deepseek-chat", 1, 1, 5))
            .await
            .expect("自愈");
        assert_eq!(count(&db).await.expect("总数"), 1);
    }

    #[test]
    fn day_key_is_utc_and_survives_bad_timestamps() {
        assert_eq!(day_key(0), "1970-01-01");
        // 2026-11-10T00:00:00Z
        let at = chrono::DateTime::parse_from_rfc3339("2026-11-10T00:00:00Z")
            .expect("parse")
            .timestamp_millis();
        assert_eq!(day_key(at), "2026-11-10");
        // 「同一天」的边界：UTC 23:59:59 仍属当天
        assert_eq!(day_key(at + 86_399_000), "2026-11-10");
        assert_eq!(day_key(at + 86_400_000), "2026-11-11");
    }
}
