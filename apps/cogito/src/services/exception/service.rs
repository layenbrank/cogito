use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, Utc};
use entity::exception;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, DbErr, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::services::exception::schema::{
    ExceptionR, GroupPageR, GroupR, LEVELS, PageR, QueryP, SummaryR, WriteP,
};
use crate::utils::code::{data, external, request, resource};
use crate::utils::db::is_unique_violation;

const PAGE_SIZE: u64 = 50;
const MAX_TAKE: u64 = 100;

#[derive(Debug, thiserror::Error)]
pub enum ReportError {
    #[error("{0}")]
    BadParam(String),
    #[error("异常事件不存在")]
    NotFound,
    #[error("eventID 已存在")]
    DuplicateEvent,
    #[error("Database error: {0}")]
    Db(String),
}

impl From<ReportError> for Exception {
    fn from(err: ReportError) -> Self {
        match err {
            ReportError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            ReportError::NotFound => Exception::custom(resource::NOT_FOUND, "异常事件不存在"),
            ReportError::DuplicateEvent => {
                Exception::custom(data::DUPLICATE_DATA, "eventID 已存在")
            }
            ReportError::Db(msg) => {
                tracing::error!(error = %msg, "exception database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

pub struct ExceptionService;

impl ExceptionService {
    /// 客户端上报（eventID 由客户端提供；fingerprint 可缺省生成）。
    pub async fn toWrite(
        scope: &PlatformScope,
        body: WriteP,
        session_user: Option<Uuid>,
        default_env: &str,
    ) -> Result<ExceptionR, ReportError> {
        let validated = validate_write(body)?;
        let fingerprint = parse_fingerprint(
            &validated.message,
            &validated.url,
            validated.status,
            validated.fingerprint.as_deref(),
        );
        let source = validated
            .source
            .unwrap_or_else(|| "client".to_string());
        let level = validated
            .level
            .unwrap_or_else(|| "error".to_string());
        let user_id = match validated.user_id {
            Some(id) if !id.is_empty() => Some(id),
            _ => session_user.map(|id| id.to_string()),
        };
        let environment = validated
            .environment
            .filter(|value| !value.is_empty())
            .or_else(|| {
                if default_env.is_empty() {
                    None
                } else {
                    Some(default_env.to_string())
                }
            });
        let now = Utc::now().fixed_offset();

        let model = exception::ActiveModel {
            id: Set(Uuid::new_v4()),
            event_id: Set(validated.event_id),
            fingerprint: Set(fingerprint),
            source: Set(source),
            level: Set(level),
            message: Set(validated.message),
            stack: Set(validated.stack),
            status: Set(validated.status),
            method: Set(validated.method),
            url: Set(validated.url),
            req_id: Set(validated.req_id),
            ip: Set(validated.ip),
            user_agent: Set(validated.user_agent),
            user_id: Set(user_id),
            environment: Set(environment),
            release: Set(validated.release),
            context: Set(validated.context),
            timestamp: Set(validated.timestamp),
            received_at: Set(now),
            creator: Set(session_user),
        };

        let inserted = model.insert(scope.tx()).await.map_err(map_insert_err)?;
        Ok(into_r(inserted))
    }

    pub async fn toList(scope: &PlatformScope, query: QueryP) -> Result<PageR, ReportError> {
        let (take, skip) = page_bounds(&query)?;
        let filter = build_filter(&query, true)?;
        let total = exception::Entity::find()
            .filter(filter.clone())
            .count(scope.tx())
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;
        let rows = exception::Entity::find()
            .filter(filter)
            .order_by_desc(exception::Column::ReceivedAt)
            .limit(take)
            .offset(skip)
            .all(scope.tx())
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;
        Ok(PageR {
            items: rows.into_iter().map(into_r).collect(),
            total,
        })
    }

    pub async fn toRead(scope: &PlatformScope, id: Uuid) -> Result<ExceptionR, ReportError> {
        let row = exception::Entity::find_by_id(id)
            .one(scope.tx())
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?
            .ok_or(ReportError::NotFound)?;
        Ok(into_r(row))
    }

    pub async fn toRemove(scope: &PlatformScope, id: Uuid) -> Result<(), ReportError> {
        let result = exception::Entity::delete_by_id(id)
            .exec(scope.tx())
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;
        if result.rows_affected == 0 {
            return Err(ReportError::NotFound);
        }
        Ok(())
    }

    pub async fn groups(scope: &PlatformScope, query: QueryP) -> Result<GroupPageR, ReportError> {
        let (take, skip) = page_bounds(&query)?;
        let where_sql = filter_sql(&query, false)?;
        let count_sql = format!(
            r#"SELECT COUNT(DISTINCT fingerprint)::bigint AS total FROM exception e WHERE {where_sql}"#
        );
        let total = query_scalar_u64(scope.tx(), &count_sql, &bind_values(&query, false)?).await?;
        if total == 0 {
            return Ok(GroupPageR {
                items: vec![],
                total: 0,
            });
        }

        // take/skip 已经过 page_bounds 校验为有界 u64，可安全嵌入 LIMIT/OFFSET。
        let agg_sql = format!(
            r#"
            SELECT fingerprint,
                   COUNT(*)::bigint AS count,
                   MAX("receivedAt") AS "lastSeen",
                   MIN("receivedAt") AS "firstSeen"
            FROM exception e
            WHERE {where_sql}
            GROUP BY fingerprint
            ORDER BY "lastSeen" DESC
            LIMIT {take} OFFSET {skip}
            "#
        );
        let aggregates = scope
            .tx()
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                &agg_sql,
                bind_values(&query, false)?,
            ))
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;

        if aggregates.is_empty() {
            return Ok(GroupPageR {
                items: vec![],
                total,
            });
        }

        let fingerprints: Vec<String> = aggregates
            .iter()
            .filter_map(|row| row.try_get::<String>("", "fingerprint").ok())
            .collect();

        let samples = exception::Entity::find()
            .filter(exception::Column::Fingerprint.is_in(fingerprints.clone()))
            .order_by_asc(exception::Column::Fingerprint)
            .order_by_desc(exception::Column::ReceivedAt)
            .all(scope.tx())
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;

        // 每个 fingerprint 取第一条（已按 fingerprint asc + receivedAt desc；手动去重）
        let mut sample_by = BTreeMap::<String, exception::Model>::new();
        for sample in samples {
            sample_by.entry(sample.fingerprint.clone()).or_insert(sample);
        }

        let items = aggregates
            .into_iter()
            .filter_map(|row| {
                let fingerprint = row.try_get::<String>("", "fingerprint").ok()?;
                let count = row.try_get::<i64>("", "count").ok()? as u64;
                let last_seen = row
                    .try_get::<DateTime<FixedOffset>>("", "lastSeen")
                    .ok()?
                    .timestamp_millis();
                let first_seen = row
                    .try_get::<DateTime<FixedOffset>>("", "firstSeen")
                    .ok()?
                    .timestamp_millis();
                let sample = sample_by.get(&fingerprint);
                Some(GroupR {
                    fingerprint,
                    count,
                    last_seen,
                    first_seen,
                    message: sample.map(|s| s.message.clone()).unwrap_or_default(),
                    level: sample
                        .map(|s| s.level.clone())
                        .unwrap_or_else(|| "error".into()),
                    source: sample
                        .map(|s| s.source.clone())
                        .unwrap_or_else(|| "client".into()),
                    url: sample.map(|s| s.url.clone()).unwrap_or_default(),
                    environment: sample.and_then(|s| s.environment.clone()),
                    status: sample.and_then(|s| s.status),
                })
            })
            .collect();

        Ok(GroupPageR { items, total })
    }

    pub async fn sources(scope: &PlatformScope) -> Result<Vec<String>, ReportError> {
        let sql = r#"
            SELECT DISTINCT source
            FROM exception
            WHERE source IS NOT NULL AND source <> ''
            ORDER BY source ASC
        "#;
        let rows = scope
            .tx()
            .query_all_raw(Statement::from_string(DatabaseBackend::Postgres, sql))
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;
        let mut out = Vec::with_capacity(rows.len());
        for row in rows {
            if let Ok(source) = row.try_get::<String>("", "source") {
                out.push(source);
            }
        }
        Ok(out)
    }

    pub async fn summary(scope: &PlatformScope, query: QueryP) -> Result<SummaryR, ReportError> {
        let where_sql = filter_sql(&query, false)?;
        let binds = bind_values(&query, false)?;
        let total_sql =
            format!(r#"SELECT COUNT(*)::bigint AS total FROM exception e WHERE {where_sql}"#);
        let total = query_scalar_u64(scope.tx(), &total_sql, &binds).await?;
        if total == 0 {
            return Ok(SummaryR {
                total: 0,
                by_level: BTreeMap::new(),
                by_source: BTreeMap::new(),
            });
        }

        let level_sql = format!(
            r#"SELECT level, COUNT(*)::bigint AS count FROM exception e WHERE {where_sql} GROUP BY level"#
        );
        let source_sql = format!(
            r#"SELECT source, COUNT(*)::bigint AS count FROM exception e WHERE {where_sql} GROUP BY source"#
        );

        let level_rows = scope
            .tx()
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                &level_sql,
                binds.clone(),
            ))
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;
        let source_rows = scope
            .tx()
            .query_all_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                &source_sql,
                binds,
            ))
            .await
            .map_err(|e| ReportError::Db(e.to_string()))?;

        let mut by_level = BTreeMap::new();
        for row in level_rows {
            let level = row
                .try_get::<String>("", "level")
                .map_err(|e| ReportError::Db(e.to_string()))?;
            let count = row.try_get::<i64>("", "count").unwrap_or(0) as u64;
            by_level.insert(level, count);
        }
        let mut by_source = BTreeMap::new();
        for row in source_rows {
            let source = row
                .try_get::<String>("", "source")
                .map_err(|e| ReportError::Db(e.to_string()))?;
            let count = row.try_get::<i64>("", "count").unwrap_or(0) as u64;
            by_source.insert(source, count);
        }

        Ok(SummaryR {
            total,
            by_level,
            by_source,
        })
    }
}

#[derive(Debug)]
struct ValidatedWrite {
    event_id: String,
    message: String,
    timestamp: i64,
    url: String,
    stack: Option<String>,
    level: Option<String>,
    status: Option<i32>,
    method: Option<String>,
    req_id: Option<String>,
    ip: Option<String>,
    user_agent: Option<String>,
    user_id: Option<String>,
    environment: Option<String>,
    release: Option<String>,
    context: Option<Value>,
    fingerprint: Option<String>,
    source: Option<String>,
}

fn validate_write(body: WriteP) -> Result<ValidatedWrite, ReportError> {
    let event_id = body.event_id.trim().to_string();
    Uuid::parse_str(&event_id)
        .map_err(|_| ReportError::BadParam("eventID 必须是合法 UUID".into()))?;

    let message = body.message.trim().to_string();
    if message.is_empty() {
        return Err(ReportError::BadParam("message 不能为空".into()));
    }
    if message.len() > 2000 {
        return Err(ReportError::BadParam("message 过长（≤2000）".into()));
    }

    if body.timestamp <= 0 {
        return Err(ReportError::BadParam("timestamp 必须为正数毫秒时间戳".into()));
    }

    let url = body.url.trim().to_string();
    if url.is_empty() || url.len() > 2000 {
        return Err(ReportError::BadParam("url 无效或过长（≤2000）".into()));
    }
    if url::Url::parse(&url).is_err() {
        return Err(ReportError::BadParam("url 不是合法 URL".into()));
    }

    let stack = truncate_opt(body.stack, 20_000, "stack")?;
    let level = match body.level {
        Some(raw) => {
            let level = raw.trim().to_ascii_lowercase();
            if !LEVELS.contains(&level.as_str()) {
                return Err(ReportError::BadParam(
                    "level 仅允许 fatal|error|warning|info".into(),
                ));
            }
            Some(level)
        }
        None => None,
    };
    let status = match body.status {
        Some(code) if (100..=599).contains(&code) => Some(code),
        Some(_) => return Err(ReportError::BadParam("status 须在 100–599".into())),
        None => None,
    };
    let method = truncate_opt(body.method, 16, "method")?;
    let req_id = truncate_opt(body.req_id, 128, "reqID")?;
    let ip = truncate_opt(body.ip, 64, "ip")?;
    let user_agent = truncate_opt(body.user_agent, 500, "userAgent")?;
    let user_id = truncate_opt(body.user_id, 128, "userID")?;
    let environment = truncate_opt(body.environment, 32, "environment")?;
    let release = truncate_opt(body.release, 64, "release")?;
    let fingerprint = truncate_opt(body.fingerprint, 64, "fingerprint")?;
    let source = truncate_opt(body.source, 64, "source")?;
    let context = body.context.filter(|value| !value.is_null());

    Ok(ValidatedWrite {
        event_id,
        message,
        timestamp: body.timestamp,
        url,
        stack,
        level,
        status,
        method,
        req_id,
        ip,
        user_agent,
        user_id,
        environment,
        release,
        context,
        fingerprint,
        source,
    })
}

fn truncate_opt(
    value: Option<String>,
    max: usize,
    field: &str,
) -> Result<Option<String>, ReportError> {
    match value {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim().to_string();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if trimmed.len() > max {
                return Err(ReportError::BadParam(format!("{field} 过长（≤{max}）")));
            }
            Ok(Some(trimmed))
        }
    }
}

fn parse_fingerprint(
    message: &str,
    url: &str,
    status: Option<i32>,
    fingerprint: Option<&str>,
) -> String {
    if let Some(fp) = fingerprint.filter(|s| !s.is_empty()) {
        return fp.chars().take(64).collect();
    }
    let status_part = status.map(|s| s.to_string()).unwrap_or_default();
    let raw = format!("{message}|{url}|{status_part}");
    let digest = Sha256::digest(raw.as_bytes());
    let mut out = String::with_capacity(64);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn page_bounds(query: &QueryP) -> Result<(u64, u64), ReportError> {
    let take = query.take.unwrap_or(PAGE_SIZE);
    if !(1..=MAX_TAKE).contains(&take) {
        return Err(ReportError::BadParam(format!(
            "take 须在 1–{MAX_TAKE}"
        )));
    }
    let skip = query.skip.unwrap_or(0);
    Ok((take, skip))
}

fn build_filter(query: &QueryP, include_fingerprint: bool) -> Result<Condition, ReportError> {
    let mut condition = Condition::all();
    if let Some(source) = query.source.as_deref().filter(|s| !s.is_empty()) {
        if source.len() > 64 {
            return Err(ReportError::BadParam("source 过长（≤64）".into()));
        }
        condition = condition.add(exception::Column::Source.eq(source));
    }
    if let Some(level) = query.level.as_deref().filter(|s| !s.is_empty()) {
        let level = level.to_ascii_lowercase();
        if !LEVELS.contains(&level.as_str()) {
            return Err(ReportError::BadParam(
                "level 仅允许 fatal|error|warning|info".into(),
            ));
        }
        condition = condition.add(exception::Column::Level.eq(level));
    }
    if include_fingerprint {
        if let Some(fp) = query.fingerprint.as_deref().filter(|s| !s.is_empty()) {
            if fp.len() > 64 {
                return Err(ReportError::BadParam("fingerprint 过长（≤64）".into()));
            }
            condition = condition.add(exception::Column::Fingerprint.eq(fp));
        }
    }
    if let Some(environment) = query.environment.as_deref().filter(|s| !s.is_empty()) {
        if environment.len() > 32 {
            return Err(ReportError::BadParam("environment 过长（≤32）".into()));
        }
        condition = condition.add(exception::Column::Environment.eq(environment));
    }
    if let Some(q) = query.q.as_deref().filter(|s| !s.is_empty()) {
        if q.len() > 200 {
            return Err(ReportError::BadParam("q 过长（≤200）".into()));
        }
        let pattern = format!("%{q}%");
        condition = condition.add(
            Condition::any()
                .add(exception::Column::Message.like(&pattern))
                .add(exception::Column::Url.like(&pattern)),
        );
    }
    if let Some(from) = &query.received_from {
        let dt = parse_iso(from, "receivedFrom")?;
        condition = condition.add(exception::Column::ReceivedAt.gte(dt));
    }
    if let Some(to) = &query.received_to {
        let dt = parse_iso(to, "receivedTo")?;
        condition = condition.add(exception::Column::ReceivedAt.lte(dt));
    }
    Ok(condition)
}

/// 动态 WHERE 片段（参数化）；`include_fingerprint=false` 时忽略 fingerprint（groups/summary）。
fn filter_sql(query: &QueryP, include_fingerprint: bool) -> Result<String, ReportError> {
    let mut parts = vec!["TRUE".to_string()];
    let mut idx = 1u32;
    if query.source.as_deref().is_some_and(|s| !s.is_empty()) {
        parts.push(format!(r#"e.source = ${idx}"#));
        idx += 1;
    }
    if query.level.as_deref().is_some_and(|s| !s.is_empty()) {
        parts.push(format!(r#"e.level = ${idx}"#));
        idx += 1;
    }
    if include_fingerprint && query.fingerprint.as_deref().is_some_and(|s| !s.is_empty()) {
        parts.push(format!(r#"e.fingerprint = ${idx}"#));
        idx += 1;
    }
    if query.environment.as_deref().is_some_and(|s| !s.is_empty()) {
        parts.push(format!(r#"e.environment = ${idx}"#));
        idx += 1;
    }
    if query.q.as_deref().is_some_and(|s| !s.is_empty()) {
        parts.push(format!(
            r#"(e.message ILIKE ${idx} OR e.url ILIKE ${idx})"#
        ));
        idx += 1;
    }
    if query.received_from.is_some() {
        parts.push(format!(r#"e."receivedAt" >= ${idx}"#));
        idx += 1;
    }
    if query.received_to.is_some() {
        parts.push(format!(r#"e."receivedAt" <= ${idx}"#));
        let _ = idx;
    }
    // 触发一次校验（长度 / level 枚举 / ISO）
    let _ = build_filter(query, include_fingerprint)?;
    Ok(parts.join(" AND "))
}

fn bind_values(
    query: &QueryP,
    include_fingerprint: bool,
) -> Result<Vec<sea_orm::Value>, ReportError> {
    let mut values = Vec::new();
    if let Some(source) = query.source.as_deref().filter(|s| !s.is_empty()) {
        values.push(source.to_string().into());
    }
    if let Some(level) = query.level.as_deref().filter(|s| !s.is_empty()) {
        values.push(level.to_ascii_lowercase().into());
    }
    if include_fingerprint {
        if let Some(fp) = query.fingerprint.as_deref().filter(|s| !s.is_empty()) {
            values.push(fp.to_string().into());
        }
    }
    if let Some(environment) = query.environment.as_deref().filter(|s| !s.is_empty()) {
        values.push(environment.to_string().into());
    }
    if let Some(q) = query.q.as_deref().filter(|s| !s.is_empty()) {
        values.push(format!("%{q}%").into());
    }
    if let Some(from) = &query.received_from {
        let dt = parse_iso(from, "receivedFrom")?;
        values.push(dt.into());
    }
    if let Some(to) = &query.received_to {
        let dt = parse_iso(to, "receivedTo")?;
        values.push(dt.into());
    }
    let _ = build_filter(query, include_fingerprint)?;
    Ok(values)
}

fn parse_iso(raw: &str, field: &str) -> Result<DateTime<FixedOffset>, ReportError> {
    DateTime::parse_from_rfc3339(raw)
        .or_else(|_| {
            raw.parse::<DateTime<Utc>>()
                .map(|dt| dt.fixed_offset())
                .map_err(|_| ())
        })
        .map_err(|_| ReportError::BadParam(format!("{field} 须为 ISO8601 时间")))
}

async fn query_scalar_u64(
    tx: &impl ConnectionTrait,
    sql: &str,
    binds: &[sea_orm::Value],
) -> Result<u64, ReportError> {
    let row = tx
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            binds.to_vec(),
        ))
        .await
        .map_err(|e| ReportError::Db(e.to_string()))?
        .ok_or_else(|| ReportError::Db("empty scalar".into()))?;
    let total = row
        .try_get::<i64>("", "total")
        .map_err(|e| ReportError::Db(e.to_string()))?;
    Ok(total as u64)
}

fn map_insert_err(err: DbErr) -> ReportError {
    if is_unique_violation(&err) {
        ReportError::DuplicateEvent
    } else {
        ReportError::Db(err.to_string())
    }
}

fn into_r(model: exception::Model) -> ExceptionR {
    ExceptionR {
        id: model.id.to_string(),
        event_id: model.event_id,
        fingerprint: model.fingerprint,
        source: model.source,
        level: model.level,
        message: model.message,
        stack: model.stack,
        status: model.status,
        method: model.method,
        url: model.url,
        req_id: model.req_id,
        ip: model.ip,
        user_agent: model.user_agent,
        user_id: model.user_id,
        environment: model.environment,
        release: model.release,
        context: model.context,
        timestamp: model.timestamp,
        received_at: model.received_at.timestamp_millis(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_uses_client_value_when_present() {
        let fp = parse_fingerprint("m", "http://a", Some(500), Some("custom-fp"));
        assert_eq!(fp, "custom-fp");
    }

    #[test]
    fn fingerprint_hashes_message_url_status() {
        let a = parse_fingerprint("boom", "http://x", Some(500), None);
        let b = parse_fingerprint("boom", "http://x", Some(500), None);
        let c = parse_fingerprint("boom", "http://x", Some(400), None);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 64);
    }

    #[test]
    fn write_rejects_bad_event_id() {
        let err = validate_write(WriteP {
            event_id: "not-uuid".into(),
            message: "x".into(),
            timestamp: 1,
            url: "http://localhost/".into(),
            stack: None,
            level: None,
            status: None,
            method: None,
            req_id: None,
            ip: None,
            user_agent: None,
            user_id: None,
            environment: None,
            release: None,
            context: None,
            fingerprint: None,
            source: None,
        })
        .unwrap_err();
        assert!(matches!(err, ReportError::BadParam(_)));
    }
}
