//! 本地工具调用审计（S6）。
//!
//! 为什么要有这张表：`app_*` 工具是 Agent 能碰本机的**唯一**入口（写文件、
//! 跑终端、点浏览器），但在此之前「谁在什么时候调了什么、成没成」只留在
//! goose 的会话消息里 —— 换会话就查不到，被拒的请求更是彻底消失。审计表把
//! 每一次 `tools::call` 落一行，失败与被拒同样记，出问题时能从库里还原时序。
//!
//! 三条硬约定：
//! - **不落 args 原文**：只存 `argsDigest`。参数里可能带密钥、隐私文本、整篇
//!   文档正文，落库等于把它们复制到另一处；摘要只服务于「这两次是不是同一次
//!   调用」；
//! - **不因审计失败影响工具调用**：写库出错只记日志，调用结果照常返回 —— 审
//!   计是旁路，不是闸门；
//! - **7 天保留**：启动时 `prune()` 裁掉过期的（`RETENTION_MS`），表不会无限长。
//!
//! 表结构单源在 `cogito_database::migrations::tool_audit_schema`；这里只负责写
//! 与读。老库 / 单测库里表可能不存在，`insert` 撞上「no such table」会补建一次
//! 再重试。

use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::Serialize;
use serde_json::Value as Json;

use super::{Effect, Risk, catalog};

/// 保留窗口：7 天。导出与裁剪共用这一个常量，避免两处漂移。
pub const RETENTION_MS: i64 = 7 * 24 * 60 * 60 * 1000;

/// 单次导出上限：诊断页只用来肉眼核对，几千行足够，再多应当直连 SQLite。
pub const EXPORT_LIMIT: u32 = 2_000;

/// `error` 列截断长度：够看清原因，又不至于把整段堆栈塞进库里。
const ERROR_CHARS: usize = 500;

/// 审计表的一行（导出给前端的形状，camelCase 与其它 IPC 一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub tool_name: String,
    /// `read` / `write` / `unknown`（未知工具或被拒请求拿不到 ToolSpec）
    pub effect: String,
    /// `read` / `write` / `guarded` / `unknown`
    pub risk: String,
    pub ok: bool,
    pub error: Option<String>,
    /// `fnv1a64:<16 hex>`：参数规范化 JSON 的摘要，**不可逆**
    pub args_digest: String,
    pub duration_ms: i64,
    pub created_at: i64,
}

/// 当前时间（毫秒）。测试里会被 `insert` 的显式时间戳绕过。
#[must_use]
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

/// 参数摘要：规范化 JSON（对象键排序）→ FNV-1a 64。
///
/// 用 FNV 而不是加密哈希：这里只需要「同参同值、异参不同值」，不承担抗碰撞
/// 安全属性，也不引新依赖；真要防篡改应当整表签名，而不是换哈希算法。
#[must_use]
pub fn digest_arguments(arguments: &Json) -> String {
    let mut canonical = String::new();
    canonical_into(arguments, &mut canonical);
    format!("fnv1a64:{:016x}", fnv1a64(canonical.as_bytes()))
}

fn canonical_into(value: &Json, out: &mut String) {
    match value {
        Json::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                // JSON 字符串转义交给 serde，避免手写转义漏掉控制字符
                out.push_str(&Json::String((*key).clone()).to_string());
                out.push(':');
                canonical_into(&map[*key], out);
            }
            out.push('}');
        }
        Json::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                canonical_into(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 效果 / 风险标签：与工具目录同源；未知工具（含被拒请求）落 `unknown`。
fn labels(tool: &str) -> (&'static str, &'static str) {
    let Some(spec) = catalog().into_iter().find(|spec| spec.name == tool) else {
        return ("unknown", "unknown");
    };
    let effect = match spec.effect {
        Effect::Read => "read",
        Effect::Write => "write",
    };
    let risk = match spec.risk {
        Risk::Read => "read",
        Risk::Write => "write",
        Risk::Guarded => "guarded",
    };
    (effect, risk)
}

/// 记一次工具调用（成功与失败都记）。
///
/// 返回值只给调用方打日志用：**不要**把它变成工具调用的错误，审计是旁路。
pub async fn record(
    db: &DatabaseConnection,
    tool: &str,
    ok: bool,
    error: Option<&str>,
    arguments: &Json,
    duration_ms: i64,
) -> Result<(), String> {
    let (effect, risk) = labels(tool);
    insert(
        db,
        tool,
        effect,
        risk,
        ok,
        error,
        arguments,
        duration_ms,
        now_ms(),
    )
    .await
}

/// 记一次被桥拒绝的请求（401 / 未知工具 / 会话未登记）。
///
/// 这类请求根本没走到 `tools::call`，不在这里记就彻底没有痕迹。
pub async fn record_rejected(
    db: &DatabaseConnection,
    tool: &str,
    reason: &str,
    arguments: &Json,
) -> Result<(), String> {
    let (effect, risk) = labels(tool);
    insert(
        db,
        tool,
        effect,
        risk,
        false,
        Some(reason),
        arguments,
        0,
        now_ms(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn insert(
    db: &DatabaseConnection,
    tool: &str,
    effect: &str,
    risk: &str,
    ok: bool,
    error: Option<&str>,
    arguments: &Json,
    duration_ms: i64,
    created_at: i64,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let digest = digest_arguments(arguments);
    let error = error.map(truncate_error);

    match insert_once(
        db,
        &id,
        tool,
        effect,
        risk,
        ok,
        error.as_deref(),
        &digest,
        duration_ms,
        created_at,
    )
    .await
    {
        Ok(()) => Ok(()),
        // 老库 / 单测内存库没跑过 migration：补建一次再重试（语句幂等）
        Err(_) => {
            ensure_table(db).await?;
            insert_once(
                db,
                &id,
                tool,
                effect,
                risk,
                ok,
                error.as_deref(),
                &digest,
                duration_ms,
                created_at,
            )
            .await
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn insert_once(
    db: &DatabaseConnection,
    id: &str,
    tool: &str,
    effect: &str,
    risk: &str,
    ok: bool,
    error: Option<&str>,
    digest: &str,
    duration_ms: i64,
    created_at: i64,
) -> Result<(), String> {
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"INSERT INTO agent_tool_audit
             (id, "toolName", effect, risk, ok, error, "argsDigest", "durationMs", "createdAt")
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
        [
            id.into(),
            tool.into(),
            effect.into(),
            risk.into(),
            (if ok { 1_i64 } else { 0 }).into(),
            error.into(),
            digest.into(),
            duration_ms.into(),
            created_at.into(),
        ],
    );
    db.execute(statement)
        .await
        .map(|_| ())
        .map_err(|error| format!("写审计失败：{error}"))
}

async fn ensure_table(db: &DatabaseConnection) -> Result<(), String> {
    for statement in cogito_database::migrations::tool_audit_schema::statements() {
        db.execute_unprepared(statement)
            .await
            .map_err(|error| format!("补建审计表失败：{error}"))?;
    }
    Ok(())
}

fn truncate_error(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= ERROR_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(ERROR_CHARS).collect();
    out.push('…');
    out
}

/// 清掉超过保留期的行。启动时调一次；失败不阻塞启动。
pub async fn prune(db: &DatabaseConnection, now: i64) -> Result<u64, String> {
    let cutoff = now - RETENTION_MS;
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"DELETE FROM agent_tool_audit WHERE "createdAt" < ?"#,
        [cutoff.into()],
    );
    match db.execute(statement).await {
        Ok(result) => Ok(result.rows_affected()),
        // 表还没建（首次启动且 migration 未跑完）：没什么可裁的
        Err(_) => Ok(0),
    }
}

/// 最近 `limit` 条（新的在前）。`limit` 会被夹到 `EXPORT_LIMIT`。
pub async fn recent(db: &DatabaseConnection, limit: u32) -> Result<Vec<Entry>, String> {
    let limit = limit.min(EXPORT_LIMIT);
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"SELECT id, "toolName", effect, risk, ok, error, "argsDigest", "durationMs", "createdAt"
             FROM agent_tool_audit
            ORDER BY "createdAt" DESC
            LIMIT ?"#,
        [i64::from(limit).into()],
    );
    let rows = db
        .query_all(statement)
        .await
        .map_err(|error| format!("读审计失败：{error}"))?;
    rows.iter()
        .map(|row| {
            Ok(Entry {
                id: row
                    .try_get::<String>("", "id")
                    .map_err(|error| format!("读 id 失败：{error}"))?,
                tool_name: row
                    .try_get::<String>("", "toolName")
                    .map_err(|error| format!("读 toolName 失败：{error}"))?,
                effect: row
                    .try_get::<String>("", "effect")
                    .map_err(|error| format!("读 effect 失败：{error}"))?,
                risk: row
                    .try_get::<String>("", "risk")
                    .map_err(|error| format!("读 risk 失败：{error}"))?,
                ok: row
                    .try_get::<i64>("", "ok")
                    .map_err(|error| format!("读 ok 失败：{error}"))?
                    != 0,
                error: row
                    .try_get::<Option<String>>("", "error")
                    .map_err(|error| format!("读 error 失败：{error}"))?,
                args_digest: row
                    .try_get::<String>("", "argsDigest")
                    .map_err(|error| format!("读 argsDigest 失败：{error}"))?,
                duration_ms: row
                    .try_get::<i64>("", "durationMs")
                    .map_err(|error| format!("读 durationMs 失败：{error}"))?,
                created_at: row
                    .try_get::<i64>("", "createdAt")
                    .map_err(|error| format!("读 createdAt 失败：{error}"))?,
            })
        })
        .collect()
}

/// 保留期内的总条数（导出页显示「最近 7 天 N 条」）。
pub async fn count(db: &DatabaseConnection) -> Result<i64, String> {
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Sqlite,
        r#"SELECT COUNT(*) AS total FROM agent_tool_audit"#,
        Vec::<sea_orm::Value>::new(),
    );
    let row = db
        .query_one(statement)
        .await
        .map_err(|error| format!("统计审计条数失败：{error}"))?
        .ok_or_else(|| "统计审计条数失败：没有返回行".to_string())?;
    row.try_get::<i64>("", "total")
        .map_err(|error| format!("读 total 失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::Database;

    async fn test_db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        ensure_table(&db).await.expect("建审计表");
        db
    }

    fn args(text: &str) -> Json {
        serde_json::json!({ "path": text, "content": "顶一下" })
    }

    #[test]
    fn digest_ignores_key_order_and_hides_plaintext() {
        let left = serde_json::json!({ "path": "C:/a.txt", "mode": "w" });
        let right = serde_json::json!({ "mode": "w", "path": "C:/a.txt" });
        assert_eq!(digest_arguments(&left), digest_arguments(&right));
        assert_ne!(
            digest_arguments(&left),
            digest_arguments(&serde_json::json!({ "path": "C:/b.txt", "mode": "w" }))
        );
        let digest = digest_arguments(&args("C:/机密/客户名单.txt"));
        assert!(digest.starts_with("fnv1a64:"));
        assert!(!digest.contains("名单"), "摘要里不能出现参数原文");
    }

    #[tokio::test]
    async fn success_is_recorded_once_with_effect_and_risk() {
        let db = test_db().await;
        record(
            &db,
            super::super::workspace::WRITE,
            true,
            None,
            &args("a.txt"),
            42,
        )
        .await
        .expect("写审计");
        let rows = recent(&db, 10).await.expect("读审计");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].tool_name, super::super::workspace::WRITE);
        assert_eq!(rows[0].effect, "write");
        assert_eq!(rows[0].risk, "guarded");
        assert!(rows[0].ok);
        assert_eq!(rows[0].duration_ms, 42);
        assert!(rows[0].error.is_none());
        assert!(rows[0].args_digest.starts_with("fnv1a64:"));
    }

    #[tokio::test]
    async fn failures_are_recorded_with_reason() {
        let db = test_db().await;
        record(
            &db,
            "app_workspace_read",
            false,
            Some("超出白名单"),
            &args("x"),
            3,
        )
        .await
        .expect("写审计");
        let rows = recent(&db, 10).await.expect("读审计");
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].ok);
        assert_eq!(rows[0].error.as_deref(), Some("超出白名单"));
    }

    #[tokio::test]
    async fn rejected_requests_use_unknown_effect() {
        let db = test_db().await;
        record_rejected(&db, "danger__tool", "token 无效", &args("x"))
            .await
            .expect("写审计");
        let rows = recent(&db, 10).await.expect("读审计");
        assert_eq!(rows[0].effect, "unknown");
        assert_eq!(rows[0].risk, "unknown");
        assert!(!rows[0].ok);
        assert_eq!(rows[0].duration_ms, 0);
    }

    #[tokio::test]
    async fn long_errors_are_truncated() {
        let db = test_db().await;
        let long = "错".repeat(ERROR_CHARS + 100);
        record(&db, "app_nope", false, Some(&long), &Json::Null, 1)
            .await
            .expect("写审计");
        let rows = recent(&db, 10).await.expect("读审计");
        let stored = rows[0].error.as_deref().expect("有 error");
        assert_eq!(stored.chars().count(), ERROR_CHARS + 1);
        assert!(stored.ends_with('…'));
    }

    #[tokio::test]
    async fn prune_drops_rows_outside_retention() {
        let db = test_db().await;
        let now = now_ms();
        insert(
            &db,
            "app_workspace_read",
            "read",
            "read",
            true,
            None,
            &Json::Null,
            1,
            now - RETENTION_MS - 1,
        )
        .await
        .expect("插入过期行");
        insert(
            &db,
            "app_workspace_read",
            "read",
            "read",
            true,
            None,
            &Json::Null,
            1,
            now,
        )
        .await
        .expect("插入新行");
        let dropped = prune(&db, now).await.expect("裁剪");
        assert_eq!(dropped, 1);
        let rows = recent(&db, 10).await.expect("读审计");
        assert_eq!(rows.len(), 1);
        assert_eq!(count(&db).await.expect("计数"), 1);
    }

    #[tokio::test]
    async fn recent_is_newest_first_and_clamped() {
        let db = test_db().await;
        let now = now_ms();
        for offset in 0..3 {
            insert(
                &db,
                "app_workspace_read",
                "read",
                "read",
                true,
                None,
                &Json::Null,
                1,
                now + offset,
            )
            .await
            .expect("插入");
        }
        let rows = recent(&db, 2).await.expect("读审计");
        assert_eq!(rows.len(), 2, "limit 生效");
        assert!(rows[0].created_at > rows[1].created_at, "新的在前");
    }

    #[tokio::test]
    async fn insert_creates_table_when_missing() {
        // 故意不建表：老库 / 单测库第一次写入时必须自愈，而不是静默丢掉审计
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        record(&db, "app_calendar_read", true, None, &Json::Null, 5)
            .await
            .expect("写审计");
        assert_eq!(count(&db).await.expect("计数"), 1);
    }
}
