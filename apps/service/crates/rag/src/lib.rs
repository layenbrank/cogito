//! RAG 索引任务的台账内核。
//!
//! 只回答一个问题：**一次索引任务在册上长什么样**——状态词汇、终态写回的内容、台账读写。
//! 「索引怎么跑」不在这里：它是 `cogito` 的可靠执行编排（`orchestrations/rag.rs`），
//! 对外入口在 `cogito::services::rag`。分界理由是变化原因不同——词汇与写回规则要稳，
//! 编排要跟着切块/嵌入策略演进。
//!
//! 与 `crates/agent` 同形，但台账**不含轮次**：索引是固定阶段（切块 → 嵌入 → 索引），
//! 阶段数由编排决定且随资产大小而变，写进台账只会是一个永远对不上的数字。
//! 想知道的实时进度从 durable 的 custom status 拿（`chunked:n` / `embedded:to` / `indexed`）。

pub mod persistence;

use uuid::Uuid;

/// `rag_index_task.status` 的取值。
///
/// 后两种是终态，且终态只写一次——这条规则由 [`persistence::finish`] 的锁与判断保证，
/// 不靠调用方自觉：编排是「至少执行一次」的，重复收尾必须是无操作的。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum IndexState {
    /// 编排实例已起，尚未出结果。
    Running,
    /// 编排跑到终点：切块、嵌入、落索引意图三阶段都过了。
    Succeeded,
    /// 编排失败：不可重试的错误，或可重试错误已耗尽重试。
    Failed,
}

impl IndexState {
    /// 落库字面量（也是出参字面量）。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "RUNNING",
            Self::Succeeded => "SUCCEEDED",
            Self::Failed => "FAILED",
        }
    }

    /// 解析落库字面量。
    ///
    /// 未知值一律报错，不回退成「运行中」：一次拼写错误会被读时修复当成「还没跑完」，
    /// 变成永远查不完的任务。
    ///
    /// # Errors
    /// 字面量不在三态之内时返回 [`Error::UnknownState`]。
    pub fn parse(literal: &str) -> Result<Self, Error> {
        match literal {
            "RUNNING" => Ok(Self::Running),
            "SUCCEEDED" => Ok(Self::Succeeded),
            "FAILED" => Ok(Self::Failed),
            other => Err(Error::UnknownState {
                column: "rag_index_task.status",
                literal: other.to_owned(),
            }),
        }
    }

    /// 是否终态。
    #[must_use]
    pub const fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// 新建台账行的内容。
#[derive(Clone, Debug)]
pub struct NewIndexTask {
    /// 台账行标识，同时是编排实例标识的来源（`rag-index-{id}`）。
    pub id: Uuid,
    /// 所属租户；RLS 靠这一列隔离。
    pub tenant_id: Uuid,
    /// 发起人；服务身份（无会话）触发时为 `None`。
    pub user_id: Option<Uuid>,
    /// 被索引的资产。资产的存在性、可索引性由调用方在**建行之前**判完。
    pub asset_id: Uuid,
    /// 编排实例标识，写进台账是为了让读时修复不必再拼一次字符串。
    pub instance_id: String,
}

/// 终态写回的内容。
#[derive(Clone, Debug)]
pub struct IndexOutcome {
    /// 终态；非终态会被 [`persistence::finish`] 拒绝。
    pub state: IndexState,
    /// 成功时的编排输出快照（`IndexAssetOutput`）。
    pub result: Option<serde_json::Value>,
    /// 失败原因（已分类的文案）。
    pub error: Option<String>,
}

impl IndexOutcome {
    /// 失败收尾。
    #[must_use]
    pub fn failed(error: impl Into<String>) -> Self {
        Self {
            state: IndexState::Failed,
            result: None,
            error: Some(error.into()),
        }
    }
}

/// 台账层的失败原因。文案面向运维（进日志与 `rag_index_task.error` 列），不面向终端用户。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// 数据库访问失败。
    #[error("数据库访问失败：{0}")]
    Db(#[from] sea_orm::DbErr),
    /// 库里的字面量无法识别：拒绝，不降级。`column` 形如 `rag_index_task.status`。
    #[error("`{column}` 中的字面量无法识别：{literal}")]
    UnknownState {
        /// 出错列（`表.列`）。
        column: &'static str,
        /// 原始字面量。
        literal: String,
    },
    /// 终态写回收到了非终态：「写回终态」这个动作本身只对终态有意义。
    #[error("终态写回要求终态状态，收到：{state}")]
    NotTerminal {
        /// 收到的状态字面量。
        state: &'static str,
    },
    /// 同一租户的同一资产已有在跑的索引任务（部分唯一索引 `uidx_rag_index_task_running` 挡住）。
    #[error("该资产已有正在运行的索引任务")]
    AlreadyRunning,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_literals_round_trip() {
        for state in [
            IndexState::Running,
            IndexState::Succeeded,
            IndexState::Failed,
        ] {
            assert_eq!(IndexState::parse(state.as_str()).unwrap(), state);
        }
        assert_eq!(IndexState::Running.as_str(), "RUNNING");
        assert_eq!(IndexState::Succeeded.as_str(), "SUCCEEDED");
        assert_eq!(IndexState::Failed.as_str(), "FAILED");
    }

    #[test]
    fn unknown_literals_are_rejected_with_their_column() {
        let err = IndexState::parse("DONE").unwrap_err();
        assert_eq!(
            err.to_string(),
            "`rag_index_task.status` 中的字面量无法识别：DONE"
        );
        assert!(IndexState::parse("").is_err());
        assert!(IndexState::parse("running").is_err());
    }

    #[test]
    fn only_running_is_not_terminal() {
        assert!(!IndexState::Running.is_terminal());
        assert!(IndexState::Succeeded.is_terminal());
        assert!(IndexState::Failed.is_terminal());
    }

    #[test]
    fn failed_outcome_carries_the_reason_and_no_result() {
        let outcome = IndexOutcome::failed("上游 503");
        assert_eq!(outcome.state, IndexState::Failed);
        assert!(outcome.result.is_none());
        assert_eq!(outcome.error.as_deref(), Some("上游 503"));
    }
}
