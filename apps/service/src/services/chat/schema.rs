//! 会话同步的请求 / 响应契约。
//!
//! 出参字段名与表列一一对应（`createdAt` 这类客户端时钟字段也原样带出去），中间不加一层
//! 「视图模型」：那只会多一个漂移点，而客户端要的就是它自己写上去的东西。
//!
//! 批量上限是**契约的一部分**（写在这里、由 `service` 判定）：一批的行数决定水位跨度，
//! 不设上限的话一次推送能锁住整张表，也会让增量窗口大到无法分页。

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 一批最多几行（会话 / 消息 / 用量合计）。
pub const MAX_BATCH_ROWS: usize = 500;
/// 一批最多几个墓碑（同上限）。
pub const MAX_BATCH_TOMBSTONES: usize = 500;
/// 批次标识最长字符数。
pub const MAX_BATCH_ID_CHARS: usize = 100;
/// 会话标题最长字符数。
pub const MAX_TITLE_CHARS: usize = 200;
/// 单条消息内容最长字符数（约 1MB 文本）。
pub const MAX_CONTENT_CHARS: usize = 1_000_000;
/// 一次拉取默认批次数。
pub const DEFAULT_LIMIT: u64 = 50;
/// 一次拉取最多批次数。
pub const MAX_LIMIT: u64 = 200;

/// 会话行（推送）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionP {
    /// 客户端生成的会话 id（uuid）
    pub id: String,
    pub title: String,
    pub pinned: bool,
    /// 客户端工作区标识；没有工作区时为 null
    #[serde(rename = "workspaceID")]
    pub workspace_id: Option<String>,
    /// 客户端改写时间（毫秒）
    #[serde(rename = "clientUpdatedAt")]
    pub client_updated_at: i64,
    /// 删除墓碑（客户端毫秒）；非空即「这次是来删它的」
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
}

/// 消息行（推送，追加型）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageP {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    /// 父消息；没有父行时为 null
    #[serde(rename = "parentID")]
    pub parent_id: Option<String>,
    /// 内容格式标识（如 `ith/thread-message-like`）
    pub format: String,
    /// 内容原文；服务端不解析
    pub content: String,
    /// 客户端生成时间（毫秒）
    #[serde(rename = "clientCreatedAt")]
    pub client_created_at: i64,
}

/// 用量行（推送，按 `runID` 去重）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsageP {
    pub id: String,
    /// 运行标识（客户端生成）
    #[serde(rename = "runID")]
    pub run_id: String,
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    #[serde(rename = "providerID")]
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub source: Option<String>,
    pub outcome: Option<String>,
    #[serde(rename = "inputTokens")]
    pub input_tokens: Option<i32>,
    #[serde(rename = "outputTokens")]
    pub output_tokens: Option<i32>,
    #[serde(rename = "totalTokens")]
    pub total_tokens: Option<i32>,
    #[serde(rename = "clientCreatedAt")]
    pub client_created_at: i64,
}

/// 一批要写的行。
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatUpsertsP {
    #[serde(default)]
    pub sessions: Vec<ChatSessionP>,
    #[serde(default)]
    pub messages: Vec<ChatMessageP>,
    #[serde(default)]
    pub usages: Vec<ChatUsageP>,
}

/// 一批要删的行（软删：只打墓碑）。
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeletesP {
    /// 要删的会话（客户端本地消息会级联删除，消息 id 由客户端自己一并列出）
    #[serde(rename = "sessionIDs", default)]
    pub session_ids: Vec<String>,
    #[serde(rename = "messageIDs", default)]
    pub message_ids: Vec<String>,
}

/// 推送一批改动。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatSyncP {
    /// 客户端生成的批次标识（幂等键）：重发同一批不会重复落库，也不会推高水位
    #[serde(rename = "clientBatchID")]
    pub client_batch_id: String,
    /// 本批改动所基于的水位：服务端用它识别「你改的是旧账」
    #[serde(rename = "baseRevision")]
    pub base_revision: i64,
    /// 要写的行
    #[serde(default, deserialize_with = "deserialize_upserts")]
    pub upserts: ChatUpsertsP,
    /// 要删的行
    #[serde(default, deserialize_with = "deserialize_deletes")]
    pub deletes: ChatDeletesP,
}

/// `upserts` 缺省时按「空对象」处理（而不是报错）：只推删除的批次是正常用法。
fn deserialize_upserts<'de, D>(deserializer: D) -> Result<ChatUpsertsP, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<ChatUpsertsP>::deserialize(deserializer)?.unwrap_or_default())
}

/// `deletes` 同上。
fn deserialize_deletes<'de, D>(deserializer: D) -> Result<ChatDeletesP, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Option::<ChatDeletesP>::deserialize(deserializer)?.unwrap_or_default())
}

/// 与客户端撞车的会话（服务端那份）。
///
/// 客户端据此决定谁赢：要么接受服务端这份，要么用服务端的 `clientUpdatedAt` 作新基线再推一次。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatConflictR {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    #[serde(rename = "workspaceID")]
    pub workspace_id: Option<String>,
    #[serde(rename = "clientUpdatedAt")]
    pub client_updated_at: i64,
    /// 非空表示服务端已经删了它（这时本次改动不会被落库）
    #[serde(rename = "archivedAt")]
    pub archived_at: Option<i64>,
    /// 服务端最后一次改动所占的水位
    pub revision: i64,
}

/// 推送结果。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatSyncR {
    /// 本批写入的行数（含墓碑）；重发同一批时回放的是台账里记下的值
    pub applied: i32,
    /// 本批占用的水位
    pub revision: i64,
    /// 被服务端更新的那份挡下的会话改动；为空即「这批全落了」
    pub conflicts: Vec<ChatConflictR>,
}

/// 增量里的会话行。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionR {
    pub id: String,
    pub title: String,
    pub pinned: bool,
    #[serde(rename = "workspaceID")]
    pub workspace_id: Option<String>,
    #[serde(rename = "clientUpdatedAt")]
    pub client_updated_at: i64,
    pub revision: i64,
}

/// 增量里的消息行。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageR {
    pub id: String,
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(rename = "parentID")]
    pub parent_id: Option<String>,
    pub format: String,
    pub content: String,
    #[serde(rename = "clientCreatedAt")]
    pub client_created_at: i64,
    pub revision: i64,
}

/// 增量里的用量行。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsageR {
    pub id: String,
    #[serde(rename = "runID")]
    pub run_id: String,
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    #[serde(rename = "providerID")]
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub source: Option<String>,
    pub outcome: Option<String>,
    #[serde(rename = "inputTokens")]
    pub input_tokens: Option<i32>,
    #[serde(rename = "outputTokens")]
    pub output_tokens: Option<i32>,
    #[serde(rename = "totalTokens")]
    pub total_tokens: Option<i32>,
    #[serde(rename = "clientCreatedAt")]
    pub client_created_at: i64,
    pub revision: i64,
}

/// 一个水位上的全部变更。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatChangeBatchR {
    /// 这一批占用的水位
    pub revision: i64,
    pub sessions: Vec<ChatSessionR>,
    pub messages: Vec<ChatMessageR>,
    pub usages: Vec<ChatUsageR>,
    /// 这一批里被删的会话
    #[serde(rename = "deletedSessionIDs")]
    pub deleted_session_ids: Vec<String>,
    /// 这一批里被删的消息
    #[serde(rename = "deletedMessageIDs")]
    pub deleted_message_ids: Vec<String>,
}

/// 一次增量拉取的结果。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatChangesR {
    /// 客户端下次拉取带的游标（= 本次交付到的水位）；没有新批次时原样返回请求里的 `since`
    pub revision: i64,
    /// 还有更多，接着拉
    #[serde(rename = "hasMore")]
    pub has_more: bool,
    /// 按水位升序的批次
    pub items: Vec<ChatChangeBatchR>,
}
