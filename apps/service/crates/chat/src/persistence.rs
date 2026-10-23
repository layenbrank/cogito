//! 台账读写：水位分配、批次落库、增量窗口切片。
//!
//! 所有函数都要求调用方**已经在正确的作用域里**（四张 chat 表都启用了 RLS），因此这里不写
//! `"tenantID" = ?` 条件：租户判定只有一处（策略），两处判定必然有一天不一致。
//! 写行时要填 `"tenantID"` 列，那是「记下这行属于谁」，不是「筛出谁的行」。

use std::collections::{BTreeMap, HashSet};

use chrono::{DateTime, FixedOffset, Utc};
use entity::{chat_message, chat_session, chat_sync_batch, chat_usage};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, IntoActiveModel,
    QueryFilter, QueryOrder, QuerySelect, Set, Statement,
    prelude::Json,
};
use uuid::Uuid;

use crate::{
    ApplyOutcome, ChangeBatch, Changes, Error, MessageChange, MessageRow, PushBatch, SessionAction,
    SessionRow, SessionSnapshot, UsageChange, UsageRow, plan_sessions,
};

fn encode_conflicts(conflicts: &[SessionSnapshot]) -> Option<Json> {
    if conflicts.is_empty() {
        return None;
    }
    Some(Json::from(
        serde_json::to_value(conflicts).unwrap_or_else(|_| serde_json::Value::Array(vec![])),
    ))
}

fn decode_conflicts(value: &Option<Json>) -> Vec<SessionSnapshot> {
    value
        .as_ref()
        .and_then(|json| serde_json::from_value(json.clone()).ok())
        .unwrap_or_default()
}

fn replay_batch(recorded: &chat_sync_batch::Model) -> ApplyOutcome {
    ApplyOutcome {
        revision: recorded.revision,
        applied: recorded.applied,
        conflicts: decode_conflicts(&recorded.conflicts),
    }
}

/// 会话级咨询锁的命名空间（"chat"）——两把 int4 里先按它分域，避免与别的租户锁相撞。
const LOCK_NAMESPACE: i32 = 0x6368_6174;

/// 读批次台账：有记录即「这批处理过」。
///
/// 按批次标识查（主键的另一半是租户，而租户由 RLS 限定）：本函数不写租户条件，
/// 因此拿到别人的批次标识也查不到东西。
///
/// # Errors
/// 数据库访问失败。
pub async fn find_batch<C: ConnectionTrait>(
    conn: &C,
    client_batch_id: &str,
) -> Result<Option<chat_sync_batch::Model>, Error> {
    Ok(chat_sync_batch::Entity::find()
        .filter(chat_sync_batch::Column::ClientBatchId.eq(client_batch_id))
        .one(conn)
        .await?)
}

/// 当前水位：该租户已分配到的最大水位（还没有批次时为 0）。
///
/// 只看批次台账：它是水位的唯一分配者，数据行上的 `revision` 只是抄下来的值。
/// 取最新一条而不是 `MAX()`：`(tenantID, revision)` 索引直接支撑这个排序，少一层聚合。
///
/// # Errors
/// 数据库访问失败。
pub async fn current_revision<C: ConnectionTrait>(conn: &C) -> Result<i64, Error> {
    let latest = chat_sync_batch::Entity::find()
        .order_by_desc(chat_sync_batch::Column::Revision)
        .one(conn)
        .await?;
    Ok(latest.map(|batch| batch.revision).unwrap_or(0))
}

/// 串行化同一租户的批次写入。
///
/// 水位是「当前最大 + 1」算出来的：两个并发批次会读到同一个最大值，落库时撞唯一索引。
/// 与其让调用方重试，不如在这里按租户取一把事务级咨询锁——同一租户的同步本来就是一串短事务，
/// 排队比重试更可预期。锁随事务结束自动释放，不需要显式解锁。
///
/// # Errors
/// 数据库访问失败。
pub async fn lock_tenant<C: ConnectionTrait>(conn: &C, tenant_id: Uuid) -> Result<(), Error> {
    let bytes = tenant_id.as_bytes();
    let tenant_key = i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock($1, $2)",
        [LOCK_NAMESPACE.into(), tenant_key.into()],
    );
    conn.execute_raw(statement).await?;
    Ok(())
}

/// 落一批改动；返回本批占用的水位、写入行数与被挡下的冲突。
///
/// 顺序：**先查幂等（快路径）→ 取锁 → 锁内再查一次幂等 → 再分配水位**。
/// 锁前查避免重发白等锁；锁内复查避免两并发同批都看到「未处理」后撞主键。
///
/// 冲突**不阻断**批次：能落的行照落，冲突行留在 `conflicts` 里等客户端合并——一批里九十九条
/// 新消息不该因为一次改名撞车被整批丢掉。冲突快照写入台账，重发时原样回放。
///
/// # Errors
/// - [`Error::SessionMissing`]：消息指向了本租户不存在的会话（批次里消息必须排在会话之后）；
/// - [`Error::Db`]：其余数据库故障。
pub async fn apply<C: ConnectionTrait>(
    conn: &C,
    tenant_id: Uuid,
    user_id: Option<Uuid>,
    batch: &PushBatch,
) -> Result<ApplyOutcome, Error> {
    if let Some(recorded) = find_batch(conn, &batch.client_batch_id).await? {
        return Ok(replay_batch(&recorded));
    }

    lock_tenant(conn, tenant_id).await?;
    if let Some(recorded) = find_batch(conn, &batch.client_batch_id).await? {
        return Ok(replay_batch(&recorded));
    }

    let revision = current_revision(conn).await? + 1;
    let now = Utc::now().fixed_offset();
    let mut applied = 0i32;

    // 会话：先读服务端快照，再交给纯规则排计划（冲突判定与「有没有变」都在那里）
    let ids: Vec<Uuid> = batch.sessions.iter().map(|row| row.id).collect();
    let server = read_session_snapshots(conn, &ids).await?;
    let plan = plan_sessions(batch.base_revision, &batch.sessions, &server);
    for action in &plan.actions {
        match action {
            SessionAction::Create(row) | SessionAction::Update(row) => {
                write_session(conn, tenant_id, user_id, row, revision, now).await?;
                applied += 1;
            }
            SessionAction::Skip(_) => {}
        }
    }

    // 消息：追加型，先确认会话都在（外键报错说不清是哪一条）
    ensure_sessions(conn, batch.messages.iter().map(|row| row.session_id)).await?;
    for row in &batch.messages {
        if write_message(conn, tenant_id, row, revision, now).await? {
            applied += 1;
        }
    }

    // 用量：按运行标识去重（同一次运行重复上报即同一条）
    for row in &batch.usages {
        if write_usage(conn, tenant_id, row, revision, now).await? {
            applied += 1;
        }
    }

    // 墓碑：只打墓碑不删行——客户端要能拉到「它被删了」，也要能重放删除而不出错
    for id in &batch.deleted_session_ids {
        if archive_session(conn, *id, revision, now).await? {
            applied += 1;
        }
    }
    for id in &batch.deleted_message_ids {
        if archive_message(conn, *id, revision, now).await? {
            applied += 1;
        }
    }

    chat_sync_batch::ActiveModel {
        tenant_id: Set(tenant_id),
        client_batch_id: Set(batch.client_batch_id.clone()),
        revision: Set(revision),
        applied: Set(applied),
        conflicts: Set(encode_conflicts(&plan.conflicts)),
        created_at: Set(now),
    }
    .insert(conn)
    .await?;

    Ok(ApplyOutcome {
        revision,
        applied,
        conflicts: plan.conflicts,
    })
}

/// 按水位窗口取增量：窗口是**整批**的，批次台账决定窗口边界。
///
/// `limit` 是批次数上限而不是行数上限：批次是交付单位，切到半个批次会让客户端游标说不清
/// 「我到底拿到了哪一步」。数据行上的 `revision` 可能与它所属批次不同（同一行在更晚的批次里
/// 被改过），那种行会在**更晚**的窗口里下发，不会漏；当前窗口少一行是正常的。
///
/// # Errors
/// 数据库访问失败。
pub async fn read_changes<C: ConnectionTrait>(
    conn: &C,
    since: i64,
    limit: u64,
) -> Result<Changes, Error> {
    let mut batches = chat_sync_batch::Entity::find()
        .filter(chat_sync_batch::Column::Revision.gt(since))
        .order_by_asc(chat_sync_batch::Column::Revision)
        .limit(limit + 1)
        .all(conn)
        .await?;

    let has_more = batches.len() as u64 > limit;
    batches.truncate(limit as usize);

    let Some(cursor) = batches.last().map(|batch| batch.revision) else {
        return Ok(Changes {
            revision: since,
            has_more: false,
            items: Vec::new(),
        });
    };

    // 先按台账把窗口排出来；下面按行填进去，空批次不留（游标已经表达了它）
    let mut window: BTreeMap<i64, ChangeBatch> = batches
        .into_iter()
        .map(|batch| (batch.revision, empty_batch(batch.revision)))
        .collect();

    for snapshot in read_window_sessions(conn, since, cursor).await? {
        if let Some(entry) = window.get_mut(&snapshot.revision) {
            if snapshot.archived_at.is_some() {
                entry.deleted_session_ids.push(snapshot.id);
            } else {
                entry.sessions.push(snapshot);
            }
        }
    }

    for change in read_window_messages(conn, since, cursor).await? {
        let archived = change.archived_at.is_some();
        let (revision, id) = (change.revision, change.id);
        let Some(entry) = window.get_mut(&revision) else {
            continue;
        };
        if archived {
            entry.deleted_message_ids.push(id);
        } else {
            entry.messages.push(MessageChange {
                id,
                session_id: change.session_id,
                parent_id: change.parent_id,
                format: change.format,
                content: change.content,
                client_created_at: change.client_created_at,
                revision,
            });
        }
    }

    for change in read_window_usages(conn, since, cursor).await? {
        if let Some(entry) = window.get_mut(&change.revision) {
            entry.usages.push(change);
        }
    }

    let items = window
        .into_values()
        .filter(|entry| {
            !entry.sessions.is_empty()
                || !entry.messages.is_empty()
                || !entry.usages.is_empty()
                || !entry.deleted_session_ids.is_empty()
                || !entry.deleted_message_ids.is_empty()
        })
        .collect();

    Ok(Changes {
        revision: cursor,
        has_more,
        items,
    })
}

fn empty_batch(revision: i64) -> ChangeBatch {
    ChangeBatch {
        revision,
        sessions: Vec::new(),
        messages: Vec::new(),
        usages: Vec::new(),
        deleted_session_ids: Vec::new(),
        deleted_message_ids: Vec::new(),
    }
}

/// 服务端已有的会话快照（按 id 批量取）。
async fn read_session_snapshots<C: ConnectionTrait>(
    conn: &C,
    ids: &[Uuid],
) -> Result<Vec<SessionSnapshot>, Error> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = chat_session::Entity::find()
        .filter(chat_session::Column::Id.is_in(ids.iter().copied()))
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(snapshot_of).collect())
}

fn snapshot_of(model: chat_session::Model) -> SessionSnapshot {
    SessionSnapshot {
        id: model.id,
        title: model.title,
        pinned: model.pinned,
        workspace_id: model.workspace_id,
        client_updated_at: model.client_updated_at,
        archived_at: model.archived_at,
        revision: model.revision,
    }
}

/// 写一行会话（有就更新，没有就建）。调用方已在锁内，不会并发建同一行。
async fn write_session<C: ConnectionTrait>(
    conn: &C,
    tenant_id: Uuid,
    user_id: Option<Uuid>,
    row: &SessionRow,
    revision: i64,
    now: DateTime<FixedOffset>,
) -> Result<(), Error> {
    match chat_session::Entity::find_by_id(row.id).one(conn).await? {
        Some(existing) => {
            let mut active = existing.into_active_model();
            active.title = Set(row.title.clone());
            active.pinned = Set(row.pinned);
            active.workspace_id = Set(row.workspace_id.clone());
            active.client_updated_at = Set(row.client_updated_at);
            active.archived_at = Set(row.archived_at);
            active.revision = Set(revision);
            active.updated_at = Set(now);
            active.update(conn).await?;
        }
        None => {
            chat_session::ActiveModel {
                id: Set(row.id),
                tenant_id: Set(tenant_id),
                user_id: Set(user_id),
                title: Set(row.title.clone()),
                pinned: Set(row.pinned),
                workspace_id: Set(row.workspace_id.clone()),
                revision: Set(revision),
                client_updated_at: Set(row.client_updated_at),
                archived_at: Set(row.archived_at),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(conn)
            .await?;
        }
    }
    Ok(())
}

/// 建一行消息；已经有了就不动（追加型，重发即无操作）。返回是否真的写了。
async fn write_message<C: ConnectionTrait>(
    conn: &C,
    tenant_id: Uuid,
    row: &MessageRow,
    revision: i64,
    now: DateTime<FixedOffset>,
) -> Result<bool, Error> {
    if chat_message::Entity::find_by_id(row.id)
        .one(conn)
        .await?
        .is_some()
    {
        return Ok(false);
    }
    chat_message::ActiveModel {
        id: Set(row.id),
        tenant_id: Set(tenant_id),
        session_id: Set(row.session_id),
        parent_id: Set(row.parent_id),
        format: Set(row.format.clone()),
        content: Set(row.content.clone()),
        client_created_at: Set(row.client_created_at),
        revision: Set(revision),
        archived_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(conn)
    .await?;
    Ok(true)
}

/// 记一笔用量；同一运行标识已经有了就不动。返回是否真的写了。
async fn write_usage<C: ConnectionTrait>(
    conn: &C,
    tenant_id: Uuid,
    row: &UsageRow,
    revision: i64,
    now: DateTime<FixedOffset>,
) -> Result<bool, Error> {
    let existing = chat_usage::Entity::find()
        .filter(chat_usage::Column::RunId.eq(row.run_id.as_str()))
        .one(conn)
        .await?;
    if existing.is_some() {
        return Ok(false);
    }
    chat_usage::ActiveModel {
        id: Set(row.id),
        tenant_id: Set(tenant_id),
        session_id: Set(row.session_id),
        run_id: Set(row.run_id.clone()),
        provider_id: Set(row.provider_id.clone()),
        model: Set(row.model.clone()),
        source: Set(row.source.clone()),
        outcome: Set(row.outcome.clone()),
        input_tokens: Set(row.input_tokens),
        output_tokens: Set(row.output_tokens),
        total_tokens: Set(row.total_tokens),
        client_created_at: Set(row.client_created_at),
        revision: Set(revision),
        created_at: Set(now),
        updated_at: Set(now),
    }
    .insert(conn)
    .await?;
    Ok(true)
}

/// 打会话墓碑；已经删过的返回 `false`（不重复占水位）。
async fn archive_session<C: ConnectionTrait>(
    conn: &C,
    id: Uuid,
    revision: i64,
    now: DateTime<FixedOffset>,
) -> Result<bool, Error> {
    let Some(existing) = chat_session::Entity::find_by_id(id).one(conn).await? else {
        return Ok(false);
    };
    if existing.archived_at.is_some() {
        return Ok(false);
    }
    let mut active = existing.into_active_model();
    active.archived_at = Set(Some(now.timestamp_millis()));
    active.revision = Set(revision);
    active.updated_at = Set(now);
    active.update(conn).await?;
    Ok(true)
}

/// 打消息墓碑；已经删过的返回 `false`。
async fn archive_message<C: ConnectionTrait>(
    conn: &C,
    id: Uuid,
    revision: i64,
    now: DateTime<FixedOffset>,
) -> Result<bool, Error> {
    let Some(existing) = chat_message::Entity::find_by_id(id).one(conn).await? else {
        return Ok(false);
    };
    if existing.archived_at.is_some() {
        return Ok(false);
    }
    let mut active = existing.into_active_model();
    active.archived_at = Set(Some(now.timestamp_millis()));
    active.revision = Set(revision);
    active.updated_at = Set(now);
    active.update(conn).await?;
    Ok(true)
}

/// 消息引用的会话必须存在且未软删：一次查清缺哪些，报第一条缺的。
async fn ensure_sessions<C: ConnectionTrait>(
    conn: &C,
    session_ids: impl Iterator<Item = Uuid>,
) -> Result<(), Error> {
    let needed: HashSet<Uuid> = session_ids.collect();
    if needed.is_empty() {
        return Ok(());
    }
    let rows = chat_session::Entity::find()
        .filter(chat_session::Column::Id.is_in(needed.iter().copied()))
        .all(conn)
        .await?;
    let found: HashSet<Uuid> = rows
        .iter()
        .filter(|model| model.archived_at.is_none())
        .map(|model| model.id)
        .collect();

    match needed.difference(&found).next() {
        Some(missing) => Err(Error::SessionMissing(*missing)),
        None => Ok(()),
    }
}

async fn read_window_sessions<C: ConnectionTrait>(
    conn: &C,
    since: i64,
    cursor: i64,
) -> Result<Vec<SessionSnapshot>, Error> {
    let rows = chat_session::Entity::find()
        .filter(chat_session::Column::Revision.gt(since))
        .filter(chat_session::Column::Revision.lte(cursor))
        .order_by_asc(chat_session::Column::Revision)
        .all(conn)
        .await?;
    Ok(rows.into_iter().map(snapshot_of).collect())
}

/// 窗口内的消息行；`archived_at` 一并带出来（调用方据此决定它是内容还是墓碑）。
struct MessageWindowRow {
    id: Uuid,
    session_id: Uuid,
    parent_id: Option<Uuid>,
    format: String,
    content: String,
    client_created_at: i64,
    revision: i64,
    archived_at: Option<i64>,
}

async fn read_window_messages<C: ConnectionTrait>(
    conn: &C,
    since: i64,
    cursor: i64,
) -> Result<Vec<MessageWindowRow>, Error> {
    let rows = chat_message::Entity::find()
        .filter(chat_message::Column::Revision.gt(since))
        .filter(chat_message::Column::Revision.lte(cursor))
        .order_by_asc(chat_message::Column::Revision)
        .all(conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(|model| MessageWindowRow {
            id: model.id,
            session_id: model.session_id,
            parent_id: model.parent_id,
            format: model.format,
            content: model.content,
            client_created_at: model.client_created_at,
            revision: model.revision,
            archived_at: model.archived_at,
        })
        .collect())
}

async fn read_window_usages<C: ConnectionTrait>(
    conn: &C,
    since: i64,
    cursor: i64,
) -> Result<Vec<UsageChange>, Error> {
    let rows = chat_usage::Entity::find()
        .filter(chat_usage::Column::Revision.gt(since))
        .filter(chat_usage::Column::Revision.lte(cursor))
        .order_by_asc(chat_usage::Column::Revision)
        .all(conn)
        .await?;
    Ok(rows
        .into_iter()
        .map(|model| UsageChange {
            id: model.id,
            run_id: model.run_id,
            session_id: model.session_id,
            provider_id: model.provider_id,
            model: model.model,
            source: model.source,
            outcome: model.outcome,
            input_tokens: model.input_tokens,
            output_tokens: model.output_tokens,
            total_tokens: model.total_tokens,
            client_created_at: model.client_created_at,
            revision: model.revision,
        })
        .collect())
}
