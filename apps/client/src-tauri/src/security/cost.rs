//! 成本账本导出（S8）。
//!
//! 与 `security::audit` 同一套口径：**只导出、不查询**。渲染进程能拿到的是
//! 「当前保留期的账 + 汇总」这一份快照，拿不到一个能按任意条件翻账的只读面。
//!
//! 导出前先按保留期裁一次：否则会出现「导出里还有一年前零一天的行，但表说只
//! 留 400 天」。

use cogito_core::cost::ledger::{self, EXPORT_LIMIT, Entry, RETENTION_MS, Totals};
use cogito_core::cost::pricing::CURRENCY;
use cogito_database::Storage;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 导出负载：诊断页原样写进 `.json` 文件。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostExport {
    /// 导出时刻（ms）
    pub exported_at: i64,
    /// 保留期（ms）：早于 `exported_at - retention_ms` 的行已被裁剪
    pub retention_ms: i64,
    /// 本次实际生效的上限（Rust 侧已夹到 `EXPORT_LIMIT`）
    pub limit: u32,
    /// 保留期内的总条数（可能大于 `entries.len()`）
    pub total: i64,
    /// 账本统一币种（未计价的行在 `entry.currency` 里是 null）
    pub currency: String,
    /// 保留期内的汇总
    pub totals: Totals,
    /// 最近 N 条，新的在前
    pub entries: Vec<Entry>,
}

/// 导出最近 N 条成本账（默认上限 5000 条）。
#[tauri::command]
pub async fn agent_cost_export(app: AppHandle, limit: Option<u32>) -> Result<CostExport, String> {
    let storage = app.state::<Storage>().inner().clone();
    export(&storage, limit).await
}

/// 命令的实现体（与 `AppHandle` 解耦，便于用内存库跑单测）。
pub async fn export(storage: &Storage, limit: Option<u32>) -> Result<CostExport, String> {
    let db = storage.connection();
    let now = ledger::now_ms();

    // 导出即顺带清理，保证导出口径与保留口径一致
    match ledger::prune(db, now).await {
        Ok(0) => {}
        Ok(dropped) => tracing::debug!(dropped, "成本账本：导出前裁剪过期行"),
        Err(error) => tracing::warn!("成本账本：导出前裁剪失败（忽略）：{error}"),
    }

    let effective = limit.unwrap_or(EXPORT_LIMIT).min(EXPORT_LIMIT);
    let total = ledger::count(db).await.unwrap_or_default();
    let totals = match ledger::totals(db).await {
        Ok(totals) => totals,
        Err(error) => {
            tracing::warn!("成本账本：读汇总失败，按空汇总处理：{error}");
            Totals::default()
        }
    };
    let entries = match ledger::recent(db, effective).await {
        Ok(entries) => entries,
        // 全新库没有账本表：按空导出处理，不要让诊断页报错
        Err(error) => {
            tracing::warn!("成本账本：读表失败，按空导出处理：{error}");
            Vec::new()
        }
    };

    tracing::debug!(
        entries = entries.len(),
        total,
        price_micros = totals.price_micros,
        "成本账本导出完成"
    );
    Ok(CostExport {
        exported_at: now,
        retention_ms: RETENTION_MS,
        limit: effective,
        total,
        currency: CURRENCY.to_string(),
        totals,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cogito_core::cost::ledger::Draft;

    async fn storage() -> Storage {
        let connection = cogito_database::initialize("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        cogito_database::migration::run(&connection)
            .await
            .expect("migration");
        Storage::new(connection)
    }

    fn draft(model: &str, at: i64) -> Draft {
        Draft {
            usage_id: format!("usage-{at}"),
            run_id: Some("run".to_string()),
            session_id: Some("session".to_string()),
            model: model.to_string(),
            input_tokens: 1_000_000,
            output_tokens: 0,
            created_at: at,
        }
    }

    #[tokio::test]
    async fn export_returns_totals_and_entries() {
        let storage = storage().await;
        let db = storage.connection();
        let now = ledger::now_ms();
        ledger::record(db, draft("deepseek-chat", now))
            .await
            .expect("落账");
        ledger::record(db, draft("mystery-model", now))
            .await
            .expect("落账");

        let out = export(&storage, Some(1)).await.expect("导出");
        assert_eq!(out.limit, 1);
        assert_eq!(out.total, 2, "总数是保留期内全部行");
        assert_eq!(out.entries.len(), 1, "limit 生效");
        assert_eq!(out.retention_ms, RETENTION_MS);
        assert_eq!(out.currency, "CNY");
        assert_eq!(out.totals.runs, 2);
        assert_eq!(out.totals.priced_runs, 1);
        assert_eq!(out.totals.unpriced_runs, 1);
        assert_eq!(out.totals.price_micros, 2_000_000);
    }

    #[tokio::test]
    async fn export_limit_is_clamped_and_defaults() {
        let storage = storage().await;
        let out = export(&storage, Some(EXPORT_LIMIT + 10))
            .await
            .expect("导出");
        assert_eq!(out.limit, EXPORT_LIMIT, "不能超过上限");
        let out = export(&storage, None).await.expect("导出");
        assert_eq!(out.limit, EXPORT_LIMIT, "缺省就是上限");
        assert!(out.entries.is_empty(), "空库导出空列表");
        assert_eq!(out.total, 0);
        assert_eq!(out.totals.runs, 0);
    }
}
