//! outbox / consumed_event 的读写。
//!
//! 两条不变量在这里落地：
//!
//! 1. **业务写入与事件写入同生共死**——[`append`] 只接受调用方的事务/连接，
//!    自己绝不开新事务，也不允许在业务事务之外单独写 outbox。
//! 2. **消费幂等靠数据库**——[`consume_once`] 用主键冲突让「同一消费者处理同一事件」
//!    最多成功一次，而不是靠应用层先查后写。

use std::future::Future;

use chrono::Utc;
use entity::{consumed_event, outbox};
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbErr, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, Statement, TryInsertResult,
};
use uuid::Uuid;

use crate::{AuditError, Event};

/// 跨租户读写 outbox 的特权通道。
///
/// `outbox` 已启用行级安全且**强制**生效（属主同样受限）：发布者要一次读到所有租户的
/// 待发布事件，只能以平台角色进入。本 crate 不自己建连接池，把「怎么开这个通道」
/// 交给调用方注入——`cogito` 侧用 `Storage::platform_tx()`（`SET LOCAL ROLE cogito_platform`）
/// 实现，这是命令式登记的平台入口，见 `apps/service/scripts/capabilities.ts` 的 R8 规则。
pub trait PlatformChannel {
    /// 开启一个平台作用域事务（跨租户可见、可写）。
    fn begin(&self) -> impl Future<Output = Result<DatabaseTransaction, DbErr>> + Send;
}

/// 在**调用方的事务**内追加事件。
///
/// 必须在业务写入的同一个事务里调用：事务提交则事件一定在，回滚则事件一定不在。
/// 事件 ID 由 [`Event::id`] 提供，因此「重放同一个事件」不会产生新事件。
///
/// 租户作用域内的连接只能写本租户的事件（RLS `WITH CHECK`）；平台级事件
/// （[`Event::tenant_id`] 为 `None`）必须在 [`PlatformChannel`] 开启的事务里写入。
///
/// # Errors
///
/// 数据库访问失败时返回 [`AuditError::Db`]。
pub async fn append<C: ConnectionTrait>(conn: &C, event: &Event) -> Result<Uuid, AuditError> {
    let model = outbox::ActiveModel {
        id: Set(event.id),
        // seq 由数据库 identity 分配，发布游标依赖它的单调性
        seq: sea_orm::NotSet,
        aggregate: Set(event.aggregate.clone()),
        aggregate_id: Set(event.aggregate_id),
        event_type: Set(event.event_type.as_str().to_owned()),
        schema_version: Set(event.schema_version),
        payload: Set(event.payload.clone()),
        traceparent: Set(event.traceparent.clone()),
        tenant_id: Set(event.tenant_id.map(|tenant| tenant.as_uuid())),
        created_at: Set(event.created_at),
        published_at: Set(None),
        attempts: Set(0),
        last_error: Set(None),
    };
    outbox::Entity::insert(model)
        .exec_without_returning(conn)
        .await?;
    Ok(event.id)
}

/// 消费幂等去重：登记「`consumer` 要处理 `event_id`」。
///
/// 返回 `true` 表示本次由调用方处理，`false` 表示该消费者已经处理过——**此时调用方必须跳过**。
/// 去重与实际副作用之间应当是同一个事务：先 `consume_once`，再写副作用，一起提交，
/// 这样崩溃重放既不会漏也不会重。
///
/// # Errors
///
/// 数据库访问失败时返回 [`AuditError::Db`]。
pub async fn consume_once<C: ConnectionTrait>(
    conn: &C,
    consumer: &str,
    event_id: Uuid,
) -> Result<bool, AuditError> {
    let model = consumed_event::ActiveModel {
        consumer: Set(consumer.to_owned()),
        event_id: Set(event_id),
        consumed_at: Set(Utc::now().fixed_offset()),
    };
    let outcome = consumed_event::Entity::insert(model)
        .on_conflict_do_nothing()
        .exec_without_returning(conn)
        .await?;
    // 冲突时 Postgres 报告 0 行受影响（SeaORM 仍然归类为 Inserted）
    Ok(matches!(outcome, TryInsertResult::Inserted(1)))
}

/// 读取一批尚未发布的事件，按追加顺序（`seq`）返回。
///
/// 只读已提交行、不加锁：多个发布者实例可以并存，最终由 [`mark_published`]
/// 的条件更新决出唯一赢家。
pub(crate) async fn pending<C: ConnectionTrait>(
    conn: &C,
    limit: u64,
) -> Result<Vec<outbox::Model>, DbErr> {
    outbox::Entity::find()
        .filter(outbox::Column::PublishedAt.is_null())
        .order_by_asc(outbox::Column::Seq)
        .limit(limit)
        .all(conn)
        .await
}

/// 标记事件已投递，并清空上次失败原因；返回是否由本次调用置位。
///
/// 条件里的 `"publishedAt" IS NULL` 是并发保护：两个发布者同时投递同一条事件时，
/// 只有一个能把它从「待发布」翻成「已发布」。
pub(crate) async fn mark_published<C: ConnectionTrait>(
    conn: &C,
    event_id: Uuid,
) -> Result<bool, DbErr> {
    let result = conn
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE outbox SET "publishedAt" = now(), "lastError" = NULL
               WHERE id = $1 AND "publishedAt" IS NULL"#,
            [event_id.into()],
        ))
        .await?;
    Ok(result.rows_affected() == 1)
}

/// 记录一次投递失败：累加尝试次数并写下原因；返回是否仍处于待发布状态。
///
/// 事件**不会**因此被丢弃——它会留在 outbox 里等下一轮，直到投递成功为止；
/// `attempts` / `lastError` 是给人看的可观测数据，不是重试逻辑的开关。
pub(crate) async fn mark_failed<C: ConnectionTrait>(
    conn: &C,
    event_id: Uuid,
    error: &str,
) -> Result<bool, DbErr> {
    let result = conn
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE outbox SET attempts = attempts + 1, "lastError" = $2
               WHERE id = $1 AND "publishedAt" IS NULL"#,
            [event_id.into(), error.into()],
        ))
        .await?;
    Ok(result.rows_affected() == 1)
}

impl From<&outbox::Model> for crate::Envelope {
    fn from(model: &outbox::Model) -> Self {
        Self {
            id: model.id,
            aggregate: model.aggregate.clone(),
            aggregate_id: model.aggregate_id,
            event_type: model.event_type.clone(),
            schema_version: model.schema_version,
            payload: model.payload.clone(),
            tenant_id: model.tenant_id,
            traceparent: model.traceparent.clone(),
            created_at: model.created_at,
        }
    }
}
