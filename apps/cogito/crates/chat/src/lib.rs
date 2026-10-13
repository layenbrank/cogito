//! 会话同步的领域内核。
//!
//! 只回答一个问题：**一批客户端改动在服务端账上长什么样**——水位怎么分配、哪些行要写、
//! 哪些改动与别人的改动撞了、增量拉取的窗口怎么切。HTTP 层在 `cogito::services::chat`，
//! 表结构在 `migration`，这里不碰它们。
//!
//! 三条铁律：
//!
//! 1. **一批一个水位**。批次是这个协议的最小交付单位：一批里的行共用同一个 `revision`，
//!    增量拉取按水位整批下发，不会出现「批次只交付了一半」的裂缝。水位在租户内单调递增。
//! 2. **重发即无操作**。批次台账记下 `clientBatchID → (revision, applied)`：重发同一批时原样
//!    回放，不再动任何数据行——否则每次网络重试都会推高水位，拉取端看到一堆假变更。
//! 3. **冲突只报不改**。会话的 `title` / `pinned` 是唯一会相互覆盖的字段：服务端在**更晚的批次**
//!    里改过它、且与本次改动不同，就报冲突并**不落这次改动**，让客户端决定谁赢；
//!    消息与用量是追加型的，没有冲突可言。
//!
//! 服务端**不解读**消息内容：`format` 说明它是什么格式，`content` 原样存回。这条边界是刻意的
//! ——客户端换消息格式不该要求服务端跟着发版。

pub mod persistence;

use uuid::Uuid;

/// 一行会话的客户端快照。
///
/// `client_updated_at` 是**客户端时钟**（毫秒）：服务端只把它存下来供冲突展示，
/// 不拿它排序、也不拿它与自己的时钟比较（两个时钟不可比）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionRow {
    pub id: Uuid,
    pub title: String,
    pub pinned: bool,
    pub workspace_id: Option<String>,
    pub client_updated_at: i64,
    /// 客户端侧的删除墓碑（毫秒时间戳）；非空表示这次是「删掉它」
    pub archived_at: Option<i64>,
}

/// 一行消息的客户端快照（追加型，没有冲突面）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageRow {
    pub id: Uuid,
    pub session_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub format: String,
    pub content: String,
    pub client_created_at: i64,
}

/// 一笔用量的客户端快照（按 `run_id` 去重，追加型）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsageRow {
    pub id: Uuid,
    pub run_id: String,
    pub session_id: Option<Uuid>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub source: Option<String>,
    pub outcome: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub total_tokens: Option<i32>,
    pub client_created_at: i64,
}

/// 客户端推上来的一批改动。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PushBatch {
    /// 客户端生成的批次标识（幂等键，租户内唯一）
    pub client_batch_id: String,
    /// 客户端这次改动所基于的水位；服务端用它判断「我这批是不是建立在旧账上」
    pub base_revision: i64,
    pub sessions: Vec<SessionRow>,
    pub messages: Vec<MessageRow>,
    pub usages: Vec<UsageRow>,
    /// 要删的会话（软删：只打墓碑，行留着）
    pub deleted_session_ids: Vec<Uuid>,
    /// 要删的消息（同上）
    pub deleted_message_ids: Vec<Uuid>,
}

impl PushBatch {
    /// 本批要写的行数（不含墓碑）——上限判定用。
    #[must_use]
    pub fn row_count(&self) -> usize {
        self.sessions.len() + self.messages.len() + self.usages.len()
    }

    /// 本批要打的墓碑数。
    #[must_use]
    pub fn tombstone_count(&self) -> usize {
        self.deleted_session_ids.len() + self.deleted_message_ids.len()
    }

    /// 空批次（既没有行也没有墓碑）：不值得占一个水位。
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.row_count() == 0 && self.tombstone_count() == 0
    }
}

/// 服务端某一行的会话快照（冲突判定与「有没有变」比较都用它）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub id: Uuid,
    pub title: String,
    pub pinned: bool,
    pub workspace_id: Option<String>,
    pub client_updated_at: i64,
    pub archived_at: Option<i64>,
    /// 服务端分配的同步水位；比 `base_revision` 大即「服务端在更晚的批次里动过它」
    pub revision: i64,
}

impl SessionSnapshot {
    /// 与客户端快照逐字段比较（水位除外）：一致即为无操作，不必推高水位。
    #[must_use]
    pub fn matches(&self, row: &SessionRow) -> bool {
        self.title == row.title
            && self.pinned == row.pinned
            && self.workspace_id == row.workspace_id
            && self.client_updated_at == row.client_updated_at
            && self.archived_at == row.archived_at
    }
}

/// 一次会话行的落库意图。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SessionAction {
    /// 服务端没有这一行。
    Create(SessionRow),
    /// 存在且有字段变了。
    Update(SessionRow),
    /// 存在且逐字段一致：不动它，也不占用新水位。
    Skip(Uuid),
}

/// 一批会话行的落库计划。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionPlan {
    pub actions: Vec<SessionAction>,
    /// 服务端更新的那一份（客户端要拿它决定谁赢）
    pub conflicts: Vec<SessionSnapshot>,
}

/// 冲突面：只有这两个字段会被两端各自覆盖。
fn conflicts_with(server: &SessionSnapshot, row: &SessionRow) -> bool {
    server.title != row.title || server.pinned != row.pinned
}

/// 把一批会话改动排成落库计划：**纯函数**，不碰数据库（判定规则全在这里，便于直测）。
///
/// 判定次序：
/// 1. 服务端没有 → 建；
/// 2. 服务端已打墓碑（客户端还没拉到那次删除）→ 报冲突且不复活这一行；
/// 3. 服务端在**更晚的批次**（`server.revision > base_revision`）动过 `title`/`pinned`，且与本次不同
///    → 报冲突，不落（客户端拿服务端那份决定谁赢）；
/// 4. 逐字段一致 → 跳过；
/// 5. 其余 → 更新。
#[must_use]
pub fn plan_sessions(
    base_revision: i64,
    rows: &[SessionRow],
    server: &[SessionSnapshot],
) -> SessionPlan {
    let mut actions = Vec::with_capacity(rows.len());
    let mut conflicts = Vec::new();

    for row in rows {
        let Some(existing) = server.iter().find(|item| item.id == row.id) else {
            actions.push(SessionAction::Create(row.clone()));
            continue;
        };

        // 墓碑优先：删除是不可逆的，一次「改名」或「置顶」不能把它带回来，
        // 但要把服务端那份（带 `archived_at`）交给客户端，它才知道该把本地行也删掉。
        if existing.archived_at.is_some() && row.archived_at.is_none() {
            conflicts.push(existing.clone());
            continue;
        }

        if existing.revision > base_revision && conflicts_with(existing, row) {
            conflicts.push(existing.clone());
            continue;
        }

        if existing.matches(row) {
            actions.push(SessionAction::Skip(row.id));
            continue;
        }

        actions.push(SessionAction::Update(row.clone()));
    }

    SessionPlan { actions, conflicts }
}

/// 拉取窗口里的一批变更（一个水位一批）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChangeBatch {
    pub revision: i64,
    pub sessions: Vec<SessionSnapshot>,
    pub messages: Vec<MessageChange>,
    pub usages: Vec<UsageChange>,
    /// 本窗口内被删的会话
    pub deleted_session_ids: Vec<Uuid>,
    /// 本窗口内被删的消息
    pub deleted_message_ids: Vec<Uuid>,
}

/// 一条被改动的消息。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MessageChange {
    pub id: Uuid,
    pub session_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub format: String,
    pub content: String,
    pub client_created_at: i64,
    pub revision: i64,
}

/// 一笔被上报的用量。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsageChange {
    pub id: Uuid,
    pub run_id: String,
    pub session_id: Option<Uuid>,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub source: Option<String>,
    pub outcome: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub total_tokens: Option<i32>,
    pub client_created_at: i64,
    pub revision: i64,
}

/// 一次增量拉取的结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Changes {
    /// 客户端下次拉取用的游标（= 本次交付到的水位；没有新批次时原样返回 `since`）
    pub revision: i64,
    /// 还有更多（客户端接着拉）
    pub has_more: bool,
    pub items: Vec<ChangeBatch>,
}

/// 一次推送的结果。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApplyOutcome {
    /// 本批占用的水位；重发时回放的是台账里记下的那一个
    pub revision: i64,
    /// 本批写入的行数（含墓碑）；重发时回放
    pub applied: i32,
    /// 被服务端更新的那份挡下的会话改动
    pub conflicts: Vec<SessionSnapshot>,
}

/// 台账层的失败原因。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// 数据库访问失败。
    ///
    /// 水位串号（`(tenantID, revision)` 唯一索引）也归到这里：`apply` 一开始就按租户取了咨询锁，
    /// 真撞上说明前面那道锁没生效，是该被看见的 bug，不该用「请重试」把它盖住。
    #[error("数据库访问失败：{0}")]
    Db(#[from] sea_orm::DbErr),
    /// 消息指向了服务端没有的会话：批次次序不对（会话必须排在消息之前）。
    #[error("会话不存在：{0}")]
    SessionMissing(Uuid),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: Uuid, title: &str, pinned: bool) -> SessionRow {
        SessionRow {
            id,
            title: title.to_owned(),
            pinned,
            workspace_id: None,
            client_updated_at: 1,
            archived_at: None,
        }
    }

    fn snapshot(id: Uuid, title: &str, pinned: bool, revision: i64) -> SessionSnapshot {
        SessionSnapshot {
            id,
            title: title.to_owned(),
            pinned,
            workspace_id: None,
            client_updated_at: 1,
            archived_at: None,
            revision,
        }
    }

    #[test]
    fn missing_rows_are_created() {
        let id = Uuid::new_v4();
        let plan = plan_sessions(5, &[row(id, "新的", false)], &[]);
        assert_eq!(plan.actions, vec![SessionAction::Create(row(id, "新的", false))]);
        assert!(plan.conflicts.is_empty());
    }

    #[test]
    fn identical_rows_are_skipped_without_burning_a_revision() {
        let id = Uuid::new_v4();
        let plan = plan_sessions(5, &[row(id, "标题", true)], &[snapshot(id, "标题", true, 5)]);
        assert_eq!(plan.actions, vec![SessionAction::Skip(id)]);
    }

    #[test]
    fn conflict_is_reported_and_the_row_is_left_untouched() {
        let id = Uuid::new_v4();
        // 客户端基于水位 5 改的，服务端在水位 7 把标题改成了别的
        let plan = plan_sessions(
            5,
            &[row(id, "客户端的标题", false)],
            &[snapshot(id, "服务端的标题", false, 7)],
        );
        assert!(plan.actions.is_empty(), "冲突的行不该被写");
        assert_eq!(plan.conflicts, vec![snapshot(id, "服务端的标题", false, 7)]);
    }

    #[test]
    fn a_later_server_write_with_identical_fields_is_not_a_conflict() {
        let id = Uuid::new_v4();
        // 服务端在水位 7 动过（例如置顶开关来回一次），但当前值与客户端一致 → 无操作
        let plan = plan_sessions(5, &[row(id, "标题", true)], &[snapshot(id, "标题", true, 7)]);
        assert_eq!(plan.actions, vec![SessionAction::Skip(id)]);
        assert!(plan.conflicts.is_empty());
    }

    #[test]
    fn server_writes_inside_the_baseline_are_overwritten() {
        let id = Uuid::new_v4();
        // 服务端最后一次改动在水位 3，客户端基于水位 5 改的 → 客户端更晚，直接更新
        let plan = plan_sessions(
            5,
            &[row(id, "客户端的标题", false)],
            &[snapshot(id, "旧标题", false, 3)],
        );
        assert_eq!(
            plan.actions,
            vec![SessionAction::Update(row(id, "客户端的标题", false))]
        );
        assert!(plan.conflicts.is_empty());
    }

    #[test]
    fn a_tombstone_is_never_resurrected_by_a_late_edit() {
        let id = Uuid::new_v4();
        let mut archived = snapshot(id, "标题", false, 9);
        archived.archived_at = Some(1_700_000_000_000);

        // 客户端基于水位 5 改名：服务端已经删了它
        let plan = plan_sessions(5, &[row(id, "改个名", false)], &[archived.clone()]);
        assert!(plan.actions.is_empty(), "墓碑行不能被改活");
        assert_eq!(plan.conflicts, vec![archived]);
    }

    #[test]
    fn empty_batches_do_not_burn_a_revision() {
        assert!(PushBatch::default().is_empty());

        let with_row = PushBatch {
            sessions: vec![row(Uuid::new_v4(), "标题", false)],
            ..PushBatch::default()
        };
        assert!(!with_row.is_empty());

        let with_tombstone = PushBatch {
            deleted_message_ids: vec![Uuid::new_v4()],
            ..PushBatch::default()
        };
        assert!(!with_tombstone.is_empty());
    }
}
