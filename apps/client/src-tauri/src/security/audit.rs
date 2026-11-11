//! 工具审计导出（S6）。
//!
//! 表在 `cogito_database::migrations::tool_audit_schema`，写在
//! `cogito_core::tools::audit`（工具调用入口旁路）。这里只做「诊断页取一份
//! JSON」这一件事：先按保留期裁一次（保证导出口径与保留口径一致），再取最近
//! N 条。
//!
//! 为什么不直接给前端一个「读表」的通用命令：审计行里虽然只有摘要，但工具名
//! 与时间戳已经能还原「他那天在用 agent 干什么」；只导出不查询，能少开一个可
//! 被渲染进程滥用的只读面。

use cogito_core::tools::audit::{self, EXPORT_LIMIT, Entry, RETENTION_MS};
use cogito_database::Storage;
use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 导出负载：诊断页原样写进 `.json` 文件。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditExport {
    /// 导出时刻（ms）—— 报告里要标「这是哪一刻的快照」
    pub exported_at: i64,
    /// 保留期（ms）：早于 `exported_at - retention_ms` 的行已被裁剪
    pub retention_ms: i64,
    /// 本次实际生效的上限（已在 Rust 侧夹到 `EXPORT_LIMIT`）
    pub limit: u32,
    /// 保留期内的总条数（可能大于 `entries.len()`）
    pub total: i64,
    /// 最近 N 条，新的在前
    pub entries: Vec<Entry>,
}

/// 导出最近 N 条工具审计（默认上限 2000 条）。
#[tauri::command]
pub async fn security_audit_export(
    app: AppHandle,
    limit: Option<u32>,
) -> Result<AuditExport, String> {
    let storage = app.state::<Storage>().inner().clone();
    export(&storage, limit).await
}

/// 命令的实现体（与 `AppHandle` 解耦，便于用内存库跑单测）。
pub async fn export(storage: &Storage, limit: Option<u32>) -> Result<AuditExport, String> {
    let db = storage.connection();
    let now = audit::now_ms();

    // 导出即顺带清理：避免「导出里还有 8 天前的行，但表说只留 7 天」
    match audit::prune(db, now).await {
        Ok(0) => {}
        Ok(dropped) => tracing::debug!(dropped, "工具审计：导出前裁剪过期行"),
        // 表还没建（全新库）：没有可裁的，导出走空列表
        Err(error) => tracing::warn!("工具审计：导出前裁剪失败（忽略）：{error}"),
    }

    let effective = limit.unwrap_or(EXPORT_LIMIT).min(EXPORT_LIMIT);
    let total = audit::count(db).await.unwrap_or_default();
    let entries = match audit::recent(db, effective).await {
        Ok(entries) => entries,
        // 全新库没有审计表：按空导出处理，不要让诊断页报错
        Err(error) => {
            tracing::warn!("工具审计：读表失败，按空导出处理：{error}");
            Vec::new()
        }
    };

    tracing::debug!(entries = entries.len(), total, "工具审计导出完成");
    Ok(AuditExport {
        exported_at: now,
        retention_ms: RETENTION_MS,
        limit: effective,
        total,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use cogito_core::tools::audit as core_audit;
    use serde_json::json;

    async fn storage() -> Storage {
        let connection = cogito_database::initialize("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        cogito_database::migration::run(&connection)
            .await
            .expect("migration");
        Storage::new(connection)
    }

    #[tokio::test]
    async fn export_returns_recent_rows_and_total() {
        let storage = storage().await;
        let db = storage.connection();
        for _ in 0..3 {
            core_audit::record(
                db,
                "app_workspace_write",
                true,
                None,
                &json!({ "path": "a.txt", "content": "x" }),
                7,
            )
            .await
            .expect("写审计");
        }
        let out = export(&storage, Some(2)).await.expect("导出");
        assert_eq!(out.limit, 2);
        assert_eq!(out.total, 3, "总数是保留期内全部行");
        assert_eq!(out.entries.len(), 2, "limit 生效");
        assert_eq!(out.retention_ms, RETENTION_MS);
        assert_eq!(out.entries[0].tool_name, "app_workspace_write");
        assert!(out.entries[0].args_digest.starts_with("fnv1a64:"));
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
    }
}
