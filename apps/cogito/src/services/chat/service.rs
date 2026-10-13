//! 会话同步的领域服务：**只做校验与形状映射**。
//!
//! 水位怎么分配、冲突怎么判、增量窗口怎么切，全在 `crates/chat`；这里负责把 HTTP 形状翻译成
//! 领域形状（并在这里挡住不合法/过大的批次），再把结果翻回去。
//!
//! 校验失败的文案尽量说清「哪一条行不通」：这是客户端离线队列重放时会撞上的错误，
//! 一句「参数不合法」会让排查变成猜谜。

use std::collections::HashSet;

use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::guards::tenant::TenantCtx;
use crate::services::chat::error::ChatError;
use crate::services::chat::schema::{
    ChatChangeBatchR, ChatChangesR, ChatConflictR, ChatMessageP, ChatMessageR, ChatSessionP,
    ChatSessionR, ChatSyncP, ChatSyncR, ChatUsageP, ChatUsageR, DEFAULT_LIMIT, MAX_BATCH_ID_CHARS,
    MAX_BATCH_ROWS, MAX_BATCH_TOMBSTONES, MAX_CONTENT_CHARS, MAX_LIMIT, MAX_TITLE_CHARS,
};

/// 内容格式标识最长字符数。
const MAX_FORMAT_CHARS: usize = 200;
/// 运行标识最长字符数。
const MAX_RUN_ID_CHARS: usize = 200;
/// 工作区标识最长字符数。
const MAX_WORKSPACE_ID_CHARS: usize = 200;

/// 拉取参数。
pub struct ChangesQuery {
    pub since: i64,
    pub limit: Option<u64>,
}

pub struct ChatService;

impl ChatService {
    /// 落一批改动。
    ///
    /// 空批次（既没有行也没有墓碑）不占水位：客户端在离线队列里可能攒出空批，让它推高水位
    /// 会让每个拉取端都白跑一趟。响应里的 `revision` 是**当前水位**，客户端可以拿它当新基线。
    ///
    /// # Errors
    /// 批次不合法 422；消息引用的会话不存在 422；库错 500。
    pub async fn apply(ctx: &TenantCtx, body: ChatSyncP) -> Result<ChatSyncR, Exception> {
        let batch = parse_batch(body)?;

        if batch.is_empty() {
            let revision = chat::persistence::current_revision(ctx.tx())
                .await
                .map_err(ChatError::from)?;
            return Ok(ChatSyncR {
                applied: 0,
                revision,
                conflicts: Vec::new(),
            });
        }

        let outcome = chat::persistence::apply(
            ctx.tx(),
            ctx.tenant_id().as_uuid(),
            Some(ctx.principal().user_id().as_uuid()),
            &batch,
        )
        .await
        .map_err(ChatError::from)?;

        Ok(ChatSyncR {
            applied: outcome.applied,
            revision: outcome.revision,
            conflicts: outcome.conflicts.iter().map(conflict_of).collect(),
        })
    }

    /// 拉一个增量窗口。
    ///
    /// # Errors
    /// 游标不合法 422；库错 500。
    pub async fn changes(ctx: &TenantCtx, query: ChangesQuery) -> Result<ChatChangesR, Exception> {
        let limit = validate_cursor(&query)?;
        let changes = chat::persistence::read_changes(ctx.tx(), query.since, limit)
            .await
            .map_err(ChatError::from)?;

        Ok(ChatChangesR {
            revision: changes.revision,
            has_more: changes.has_more,
            items: changes.items.into_iter().map(batch_of).collect(),
        })
    }
}

fn validate_cursor(query: &ChangesQuery) -> Result<u64, ChatError> {
    if query.since < 0 {
        return Err(ChatError::CursorInvalid("since 不能为负".to_owned()));
    }
    match query.limit {
        None => Ok(DEFAULT_LIMIT),
        Some(0) => Err(ChatError::CursorInvalid("limit 至少为 1".to_owned())),
        Some(value) if value > MAX_LIMIT => Err(ChatError::CursorInvalid(format!(
            "limit 超出上限（{MAX_LIMIT}）"
        ))),
        Some(value) => Ok(value),
    }
}

/// HTTP 形状 → 领域形状，顺带把不合法与过大的批次挡在数据库之外。
fn parse_batch(body: ChatSyncP) -> Result<chat::PushBatch, ChatError> {
    let client_batch_id = body.client_batch_id.trim().to_owned();
    if client_batch_id.is_empty() {
        return Err(ChatError::BatchInvalid("缺少 clientBatchID".to_owned()));
    }
    if client_batch_id.chars().count() > MAX_BATCH_ID_CHARS {
        return Err(ChatError::BatchInvalid(format!(
            "clientBatchID 过长（上限 {MAX_BATCH_ID_CHARS} 字符）"
        )));
    }
    if body.base_revision < 0 {
        return Err(ChatError::BatchInvalid("baseRevision 不能为负".to_owned()));
    }

    let rows = body.upserts.sessions.len() + body.upserts.messages.len() + body.upserts.usages.len();
    if rows > MAX_BATCH_ROWS {
        return Err(ChatError::BatchInvalid(format!(
            "一批最多 {MAX_BATCH_ROWS} 行，收到 {rows} 行"
        )));
    }
    let tombstones = body.deletes.session_ids.len() + body.deletes.message_ids.len();
    if tombstones > MAX_BATCH_TOMBSTONES {
        return Err(ChatError::BatchInvalid(format!(
            "一批最多 {MAX_BATCH_TOMBSTONES} 个删除，收到 {tombstones} 个"
        )));
    }

    let mut seen: HashSet<Uuid> = HashSet::with_capacity(rows);
    let mut batch = chat::PushBatch {
        client_batch_id,
        base_revision: body.base_revision,
        ..chat::PushBatch::default()
    };

    for row in body.upserts.sessions {
        batch.sessions.push(parse_session(row, &mut seen)?);
    }
    for row in body.upserts.messages {
        batch.messages.push(parse_message(row, &mut seen)?);
    }
    for row in body.upserts.usages {
        batch.usages.push(parse_usage(row, &mut seen)?);
    }
    for raw in body.deletes.session_ids {
        batch.deleted_session_ids.push(parse_id("会话", &raw)?);
    }
    for raw in body.deletes.message_ids {
        batch.deleted_message_ids.push(parse_id("消息", &raw)?);
    }

    Ok(batch)
}

fn parse_session(
    row: ChatSessionP,
    seen: &mut HashSet<Uuid>,
) -> Result<chat::SessionRow, ChatError> {
    let id = claim_id("会话", &row.id, seen)?;
    let title = row.title.trim().to_owned();
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(ChatError::BatchInvalid(format!(
            "会话标题过长（上限 {MAX_TITLE_CHARS} 字符）"
        )));
    }
    if let Some(workspace) = row.workspace_id.as_ref()
        && workspace.chars().count() > MAX_WORKSPACE_ID_CHARS
    {
        return Err(ChatError::BatchInvalid(format!(
            "workspaceID 过长（上限 {MAX_WORKSPACE_ID_CHARS} 字符）"
        )));
    }

    Ok(chat::SessionRow {
        id,
        title,
        pinned: row.pinned,
        workspace_id: row.workspace_id.map(|value| value.trim().to_owned()),
        client_updated_at: row.client_updated_at,
        archived_at: row.archived_at,
    })
}

fn parse_message(
    row: ChatMessageP,
    seen: &mut HashSet<Uuid>,
) -> Result<chat::MessageRow, ChatError> {
    let id = claim_id("消息", &row.id, seen)?;
    let format = row.format.trim().to_owned();
    if format.is_empty() || format.chars().count() > MAX_FORMAT_CHARS {
        return Err(ChatError::BatchInvalid(format!(
            "内容格式标识缺失或过长（上限 {MAX_FORMAT_CHARS} 字符）"
        )));
    }
    if row.content.chars().count() > MAX_CONTENT_CHARS {
        return Err(ChatError::BatchInvalid(format!(
            "单条消息过长（上限 {MAX_CONTENT_CHARS} 字符）"
        )));
    }

    Ok(chat::MessageRow {
        id,
        session_id: parse_id("会话", &row.session_id)?,
        parent_id: match row.parent_id.as_deref() {
            Some(raw) => Some(parse_id("父消息", raw)?),
            None => None,
        },
        format,
        content: row.content,
        client_created_at: row.client_created_at,
    })
}

fn parse_usage(row: ChatUsageP, seen: &mut HashSet<Uuid>) -> Result<chat::UsageRow, ChatError> {
    let id = claim_id("用量", &row.id, seen)?;
    let run_id = row.run_id.trim().to_owned();
    if run_id.is_empty() || run_id.chars().count() > MAX_RUN_ID_CHARS {
        return Err(ChatError::BatchInvalid(format!(
            "runID 缺失或过长（上限 {MAX_RUN_ID_CHARS} 字符）"
        )));
    }

    Ok(chat::UsageRow {
        id,
        run_id,
        session_id: match row.session_id.as_deref() {
            Some(raw) => Some(parse_id("会话", raw)?),
            None => None,
        },
        provider_id: row.provider_id,
        model: row.model,
        source: row.source,
        outcome: row.outcome,
        input_tokens: row.input_tokens,
        output_tokens: row.output_tokens,
        total_tokens: row.total_tokens,
        client_created_at: row.client_created_at,
    })
}

/// 批内 id 必须唯一：重复的 id 说明客户端拼错了批（同一条会被写两次），早点说不。
fn claim_id(what: &str, raw: &str, seen: &mut HashSet<Uuid>) -> Result<Uuid, ChatError> {
    let id = parse_id(what, raw)?;
    if !seen.insert(id) {
        return Err(ChatError::BatchInvalid(format!(
            "同一批里出现重复的{what} id：{id}"
        )));
    }
    Ok(id)
}

fn parse_id(what: &str, raw: &str) -> Result<Uuid, ChatError> {
    Uuid::parse_str(raw.trim())
        .map_err(|_| ChatError::BatchInvalid(format!("{what} id 不是合法的 uuid")))
}

fn conflict_of(snapshot: &chat::SessionSnapshot) -> ChatConflictR {
    ChatConflictR {
        id: snapshot.id.to_string(),
        title: snapshot.title.clone(),
        pinned: snapshot.pinned,
        workspace_id: snapshot.workspace_id.clone(),
        client_updated_at: snapshot.client_updated_at,
        archived_at: snapshot.archived_at,
        revision: snapshot.revision,
    }
}

fn batch_of(batch: chat::ChangeBatch) -> ChatChangeBatchR {
    ChatChangeBatchR {
        revision: batch.revision,
        sessions: batch
            .sessions
            .iter()
            .map(|snapshot| ChatSessionR {
                id: snapshot.id.to_string(),
                title: snapshot.title.clone(),
                pinned: snapshot.pinned,
                workspace_id: snapshot.workspace_id.clone(),
                client_updated_at: snapshot.client_updated_at,
                revision: snapshot.revision,
            })
            .collect(),
        messages: batch
            .messages
            .into_iter()
            .map(|change| ChatMessageR {
                id: change.id.to_string(),
                session_id: change.session_id.to_string(),
                parent_id: change.parent_id.map(|id| id.to_string()),
                format: change.format,
                content: change.content,
                client_created_at: change.client_created_at,
                revision: change.revision,
            })
            .collect(),
        usages: batch
            .usages
            .into_iter()
            .map(|change| ChatUsageR {
                id: change.id.to_string(),
                run_id: change.run_id,
                session_id: change.session_id.map(|id| id.to_string()),
                provider_id: change.provider_id,
                model: change.model,
                source: change.source,
                outcome: change.outcome,
                input_tokens: change.input_tokens,
                output_tokens: change.output_tokens,
                total_tokens: change.total_tokens,
                client_created_at: change.client_created_at,
                revision: change.revision,
            })
            .collect(),
        deleted_session_ids: batch
            .deleted_session_ids
            .into_iter()
            .map(|id| id.to_string())
            .collect(),
        deleted_message_ids: batch
            .deleted_message_ids
            .into_iter()
            .map(|id| id.to_string())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::chat::schema::{ChatDeletesP, ChatUpsertsP};

    fn session_payload(id: &str, title: &str) -> ChatSessionP {
        ChatSessionP {
            id: id.to_owned(),
            title: title.to_owned(),
            pinned: false,
            workspace_id: None,
            client_updated_at: 1,
            archived_at: None,
        }
    }

    fn body_with(sessions: Vec<ChatSessionP>) -> ChatSyncP {
        ChatSyncP {
            client_batch_id: "batch-1".to_owned(),
            base_revision: 0,
            upserts: ChatUpsertsP {
                sessions,
                ..ChatUpsertsP::default()
            },
            deletes: ChatDeletesP::default(),
        }
    }

    #[test]
    fn cursor_defaults_and_bounds() {
        assert_eq!(
            validate_cursor(&ChangesQuery { since: 0, limit: None }).unwrap(),
            DEFAULT_LIMIT
        );
        assert!(validate_cursor(&ChangesQuery { since: -1, limit: None }).is_err());
        assert!(validate_cursor(&ChangesQuery { since: 0, limit: Some(0) }).is_err());
        assert!(validate_cursor(&ChangesQuery { since: 0, limit: Some(MAX_LIMIT + 1) }).is_err());
    }

    #[test]
    fn batch_identifier_is_required() {
        let mut body = body_with(vec![]);
        body.client_batch_id = "   ".to_owned();
        assert!(matches!(parse_batch(body), Err(ChatError::BatchInvalid(_))));
    }

    #[test]
    fn duplicate_ids_in_one_batch_are_rejected() {
        let id = Uuid::new_v4().to_string();
        let body = body_with(vec![session_payload(&id, "a"), session_payload(&id, "b")]);
        let error = parse_batch(body).unwrap_err();
        assert!(error.to_string().contains("重复"));
    }

    #[test]
    fn oversized_batches_are_rejected_before_touching_the_database() {
        let rows = (0..=MAX_BATCH_ROWS)
            .map(|_| session_payload(&Uuid::new_v4().to_string(), "标题"))
            .collect();
        let error = parse_batch(body_with(rows)).unwrap_err();
        assert!(error.to_string().contains("一批最多"));
    }

    #[test]
    fn valid_batch_maps_one_to_one() {
        let id = Uuid::new_v4().to_string();
        let parsed = parse_batch(body_with(vec![session_payload(&id, " 标题 ")])).unwrap();
        assert_eq!(parsed.sessions.len(), 1);
        assert_eq!(parsed.sessions[0].title, "标题");
        assert!(!parsed.is_empty());
    }
}
