//! 服务端 agent 的台账内核。
//!
//! 只回答一个问题：**一次 agent 任务在册上长什么样**——状态词汇、终态写回的内容、台账读写。
//! 「循环怎么转」不在这里：它跑在 `cogito` 的可靠执行编排里（`orchestrations/agent.rs`），
//! 对外入口在 `cogito::services::agent`。分界理由是变化原因不同——词汇与写回规则要稳，
//! 编排要跟着模型与工具演进。

pub mod persistence;

use uuid::Uuid;

/// `agent_task.status` 的取值。
///
/// 后两种是终态，且终态只写一次——这条规则由 [`persistence::finish`] 的锁与判断保证，
/// 不靠调用方自觉：编排是「至少执行一次」的，重复收尾必须是无操作的。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskState {
    /// 编排实例已起，尚未出结果。
    Running,
    /// 编排跑到终点：模型给出结论，或因轮次预算耗尽而停下（后者在结果快照里标 `finished=false`）。
    Succeeded,
    /// 编排失败：不可重试的错误，或可重试错误已耗尽重试。
    Failed,
}

impl TaskState {
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
                column: "agent_task.status",
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

/// `agent_approval.state` 的取值。
///
/// 也是**跨进程词汇**：编排把它写进结果快照、api 把它投进审批载荷，三处必须同一套拼写。
/// 定义只在这一处，编排（`orchestrations::agent`）与接口层都从这里借，不各自再写一份。
///
/// 台账里**只可能出现前两种**：`EXPIRED` 是编排等出来的结局，不是人做的决定，
/// 所以它落在任务结果快照里，而不是审批台账里（见 [`NewApproval`]）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalState {
    /// 人工批准：工具已执行（执行失败不影响「批了」这个事实）。
    Approved,
    /// 人工驳回：工具**没有**执行。
    Rejected,
    /// 等到逾期时间都没人处理：工具**没有**执行。
    Expired,
}

impl ApprovalState {
    /// 落库/落快照/载荷共用的字面量。
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Approved => "APPROVED",
            Self::Rejected => "REJECTED",
            Self::Expired => "EXPIRED",
        }
    }

    /// 解析字面量。
    ///
    /// 未知值一律报错，不回退成任何一个已知结局：把 `APPROVED` 读成 `REJECTED` 会让
    /// 侧信道上的判定翻面，比报错危险得多。
    ///
    /// # Errors
    /// 字面量不在三种结局之内时返回 [`Error::UnknownApprovalState`]。
    pub fn parse(literal: &str) -> Result<Self, Error> {
        match literal {
            "APPROVED" => Ok(Self::Approved),
            "REJECTED" => Ok(Self::Rejected),
            "EXPIRED" => Ok(Self::Expired),
            other => Err(Error::UnknownApprovalState {
                literal: other.to_owned(),
            }),
        }
    }
}

/// 新建台账行的内容。
#[derive(Clone, Debug)]
pub struct NewTask {
    /// 台账行标识，同时是编排实例标识的来源（`agent-{id}`）。
    pub id: Uuid,
    /// 所属租户；RLS 靠这一列隔离。
    pub tenant_id: Uuid,
    /// 发起人；服务身份（无会话）触发时为 `None`。
    pub user_id: Option<Uuid>,
    /// 任务目标，原样交给模型（长度与内容判断在 HTTP 层）。
    pub objective: String,
    /// 实际使用的模型名（网关目录里的一行）。
    pub model: String,
    /// 轮次上限。
    pub max_steps: i32,
    /// 工具白名单；空数组 = 不给工具。
    pub allowed_tools: Vec<String>,
    /// 编排实例标识，写进台账是为了让读时修复不必再拼一次字符串。
    pub instance_id: String,
}

/// 新建一条审批台账（人做的一次决定）。
///
/// **台账记的是「人做了什么」，不是「最后怎么了」**：批准就是 `APPROVED`，哪怕工具后来执行失败、
/// 哪怕编排因为决定送到得太晚而算它超时。最终结局在任务结果快照里（`approvals[]`），
/// 两者一比对，运维就能看出「批了、但没赶在逾期前送到」这类裂缝，而不是被台账抹平。
#[derive(Clone, Debug)]
pub struct NewApproval {
    /// 审批标识 `<taskID>:<步骤>:<第几次调用>`。
    ///
    /// 由编排确定性生成（重放必须算出同一个 id），api 只是把它原样记下来：所以这里用主键
    /// 而不是自增 id——**同一次调用的审批天然只有一行**，重复提交靠主键冲突暴露。
    pub id: String,
    /// 所属租户；RLS 靠这一列隔离。
    pub tenant_id: Uuid,
    /// 所属任务（外键指回 `agent_task`）。
    pub task_id: Uuid,
    /// 第几轮提出的（人需要这个上下文才知道模型当时在干什么）。
    pub step: i32,
    /// 待执行的工具名。
    pub tool: String,
    /// 模型给的参数**原文**（不做 JSON 解析：解析失败不该让「人批过什么」这件事实落不了库）。
    pub arguments: String,
    /// 人的决定：只可能是 `APPROVED` / `REJECTED`。
    pub state: ApprovalState,
    /// 做决定的人。
    pub decided_by: Uuid,
    /// 驳回理由（批准时一般为空）。
    pub reason: Option<String>,
    /// 这次待办什么时候过期——**由编排给的**，不是 api 自己算的：判定在编排侧，
    /// 台账照抄是为了让「决定晚于逾期」这种事故事后能对得上账。
    pub expires_at: chrono::DateTime<chrono::FixedOffset>,
}

/// 终态写回的内容。
///
/// 成功与失败共用一个形状：失败也留轮次，排查时不用回头翻编排日志。
#[derive(Clone, Debug)]
pub struct TaskOutcome {
    /// 终态；非终态会被 [`persistence::finish`] 拒绝。
    pub state: TaskState,
    /// 已完成的轮次（拿不到准确值时给 0）。
    pub steps: i32,
    /// 成功时的编排输出快照。
    pub result: Option<serde_json::Value>,
    /// 失败原因（已分类的文案）。
    pub error: Option<String>,
}

impl TaskOutcome {
    /// 失败收尾。
    #[must_use]
    pub fn failed(steps: i32, error: impl Into<String>) -> Self {
        Self {
            state: TaskState::Failed,
            steps,
            result: None,
            error: Some(error.into()),
        }
    }
}

/// 台账层的失败原因。文案面向运维（进日志与 `agent_task.error` 列），不面向终端用户。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// 数据库访问失败。
    #[error("数据库访问失败：{0}")]
    Db(#[from] sea_orm::DbErr),
    /// 库里的字面量无法识别：拒绝，不降级。`column` 形如 `agent_task.status`。
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
    /// `agent_approval.state` 里的字面量无法识别。
    #[error("`agent_approval.state` 中的字面量无法识别：{literal}")]
    UnknownApprovalState {
        /// 原始字面量。
        literal: String,
    },
    /// 有人想把人**不可能给出**的结局记进审批台账。
    #[error(
        "`agent_approval.state` 不接受 {state}：人只能批准或驳回，`EXPIRED` 是编排等出来的结局"
    )]
    NotHumanDecision {
        /// 收到的状态字面量。
        state: &'static str,
    },
    /// 同一次审批被两个人（或两次请求）给了**相反**的决定。
    #[error("审批 {approval_id} 已经记为 {existing}，不能改判为 {incoming}")]
    DecisionConflict {
        /// 审批标识。
        approval_id: String,
        /// 台账里已有的决定。
        existing: &'static str,
        /// 这次送来的决定。
        incoming: &'static str,
    },
    /// 刚写进去的审批行立刻读不到了。
    ///
    /// 不该发生：同一个事务里插入再读，读到的只能是它自己或更早那一行。真出现说明
    /// 作用域（租户 / 事务）被谁换掉了——宁可报错，也不要当成「没人批过」继续跑。
    #[error("审批 {approval_id} 写入后读不到")]
    ApprovalVanished {
        /// 审批标识。
        approval_id: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_literals_round_trip() {
        for state in [TaskState::Running, TaskState::Succeeded, TaskState::Failed] {
            assert_eq!(TaskState::parse(state.as_str()).unwrap(), state);
        }
        assert_eq!(TaskState::Running.as_str(), "RUNNING");
        assert_eq!(TaskState::Succeeded.as_str(), "SUCCEEDED");
        assert_eq!(TaskState::Failed.as_str(), "FAILED");
    }

    #[test]
    fn unknown_literals_are_rejected_with_their_column() {
        let err = TaskState::parse("DONE").unwrap_err();
        assert_eq!(
            err.to_string(),
            "`agent_task.status` 中的字面量无法识别：DONE"
        );
        assert!(TaskState::parse("").is_err());
        assert!(TaskState::parse("running").is_err());
    }

    #[test]
    fn only_running_is_not_terminal() {
        assert!(!TaskState::Running.is_terminal());
        assert!(TaskState::Succeeded.is_terminal());
        assert!(TaskState::Failed.is_terminal());
    }

    #[test]
    fn failed_outcome_carries_the_reason_and_no_result() {
        let outcome = TaskOutcome::failed(2, "上游 503");
        assert_eq!(outcome.state, TaskState::Failed);
        assert_eq!(outcome.steps, 2);
        assert!(outcome.result.is_none());
        assert_eq!(outcome.error.as_deref(), Some("上游 503"));
    }

    #[test]
    fn approval_literals_round_trip_across_processes() {
        for state in [
            ApprovalState::Approved,
            ApprovalState::Rejected,
            ApprovalState::Expired,
        ] {
            assert_eq!(ApprovalState::parse(state.as_str()).unwrap(), state);
        }
        assert_eq!(ApprovalState::Approved.as_str(), "APPROVED");
        assert_eq!(ApprovalState::Rejected.as_str(), "REJECTED");
        assert_eq!(ApprovalState::Expired.as_str(), "EXPIRED");
        // 跨进程只走字面量：api 投进邮箱的 JSON 必须与编排解析的是同一套拼写
        assert_eq!(
            serde_json::to_value(ApprovalState::Approved).unwrap(),
            serde_json::json!("APPROVED")
        );
        assert_eq!(
            serde_json::from_value::<ApprovalState>(serde_json::json!("REJECTED")).unwrap(),
            ApprovalState::Rejected
        );
    }

    #[test]
    fn unknown_approval_literals_are_rejected() {
        assert_eq!(
            ApprovalState::parse("approved").unwrap_err().to_string(),
            "`agent_approval.state` 中的字面量无法识别：approved"
        );
        assert!(ApprovalState::parse("").is_err());
    }
}
