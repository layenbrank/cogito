//! agent 任务的领域错误 → Exception
//!
//! 领域服务返回本枚举而不是 [`Exception`]：状态码与业务码是接口层的知识，写进服务里会让
//! 「同一段校验换一个入口（定时任务、CLI）」就得改业务逻辑。映射只在这一处做。

use crate::filters::exception::Exception;
use crate::utils::code::{business, external, system};

/// agent 域的领域错误。
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// 目标为空或超长（文案直接给调用方看）。
    #[error("{0}")]
    ObjectiveInvalid(String),
    /// 轮次预算越界（文案直接给调用方看）。
    #[error("{0}")]
    MaxStepsInvalid(String),
    /// 请求里的工具不在部署白名单内（文案直接给调用方看）。
    #[error("{0}")]
    ToolNotAllowed(String),
    /// 台账里没有这条任务，或它不在当前租户视野内。
    ///
    /// 两者合并成同一个错误：分开会让调用方能拿它探测「某个 id 在别的租户存在」。
    #[error("任务不存在")]
    NotFound,
    /// 这次调用没在等人批：审批标识对不上，或者它已经被决定/超时，或者任务已经结束。
    ///
    /// 「过期」与「不存在」合并成同一个错误，理由同 [`AgentError::NotFound`] 外加一条：
    /// 分开会告诉调用方「这个审批 id 真存在过」，而它本来不该知道别人的审批。
    #[error("{0}")]
    ApprovalNotPending(String),
    /// 同一次审批已经被给出过**相反**的决定。
    #[error("{0}")]
    ApprovalAlreadyDecided(String),
    /// 决定字面量不合法：人只能批准或驳回，未知词与 `EXPIRED` 都进不到台账。
    #[error("{0}")]
    ApprovalDecisionInvalid(String),
    /// 编排运行时不可用：未接通，或起实例失败。
    #[error("{0}")]
    OrchestrationUnavailable(String),
    /// 数据库故障。
    #[error("数据库错误：{0}")]
    Database(String),
    /// 台账读写故障：状态字面量不认识、写回终态被拒等。
    #[error("{0}")]
    Ledger(String),
}

impl From<agent::Error> for AgentError {
    fn from(err: agent::Error) -> Self {
        match err {
            agent::Error::Db(source) => Self::Database(source.to_string()),
            other => Self::Ledger(other.to_string()),
        }
    }
}

impl From<AgentError> for Exception {
    fn from(err: AgentError) -> Self {
        match err {
            AgentError::ObjectiveInvalid(msg) => {
                Exception::custom(business::agent::OBJECTIVE_INVALID, msg)
            }
            AgentError::MaxStepsInvalid(msg) => {
                Exception::custom(business::agent::MAX_STEPS_INVALID, msg)
            }
            AgentError::ToolNotAllowed(msg) => {
                Exception::custom(business::agent::TOOL_NOT_ALLOWED, msg)
            }
            AgentError::NotFound => {
                Exception::custom(business::agent::TASK_NOT_FOUND, "任务不存在")
            }
            AgentError::ApprovalNotPending(msg) => {
                // 细节（对不上的 id、已终态）留在日志里：调用方只需要知道「现在没什么可批的」。
                tracing::info!(reason = %msg, "agent 审批决定被拒：没有在等审批");
                Exception::custom(
                    business::agent::APPROVAL_NOT_PENDING,
                    "这次调用没有在等待审批（可能已批过、已超时，或任务已结束）",
                )
            }
            AgentError::ApprovalAlreadyDecided(msg) => {
                tracing::info!(reason = %msg, "agent 审批改判被拒");
                Exception::custom(
                    business::agent::APPROVAL_ALREADY_DECIDED,
                    "这次审批已有相反的决定，不能改判",
                )
            }
            AgentError::ApprovalDecisionInvalid(msg) => {
                Exception::custom(business::agent::APPROVAL_DECISION_INVALID, msg)
            }
            AgentError::OrchestrationUnavailable(msg) => {
                // 调用方看得见「暂时起不了」，排查线索留在日志里。
                tracing::error!(error = %msg, "agent 编排不可用");
                Exception::custom(
                    business::agent::ORCHESTRATION_UNAVAILABLE,
                    "编排服务暂时不可用，请稍后重试",
                )
            }
            AgentError::Database(msg) => {
                tracing::error!(error = %msg, "agent 数据库错误");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            AgentError::Ledger(msg) => {
                tracing::error!(error = %msg, "agent 台账错误");
                Exception::custom(system::INTERNAL_ERROR, "内部错误")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_errors_keep_their_own_codes() {
        let cases = [
            (
                AgentError::ObjectiveInvalid("空".into()),
                business::agent::OBJECTIVE_INVALID,
            ),
            (
                AgentError::MaxStepsInvalid("越界".into()),
                business::agent::MAX_STEPS_INVALID,
            ),
            (
                AgentError::ToolNotAllowed("不存在".into()),
                business::agent::TOOL_NOT_ALLOWED,
            ),
            (AgentError::NotFound, business::agent::TASK_NOT_FOUND),
        ];

        for (err, expected) in cases {
            assert_eq!(Exception::from(err).code, expected);
        }
    }

    #[test]
    fn orchestrator_failure_hides_the_internal_reason() {
        let body = Exception::from(AgentError::OrchestrationUnavailable(
            "instance agent-x: connection refused".into(),
        ));
        assert_eq!(body.code, business::agent::ORCHESTRATION_UNAVAILABLE);
        assert!(!body.msg.contains("connection refused"));
    }

    #[test]
    fn database_and_ledger_errors_map_to_their_families() {
        let db = Exception::from(AgentError::Database("relation missing".into()));
        assert_eq!(db.code, external::DATABASE_ERROR);
        assert!(!db.msg.contains("relation"));

        let ledger = Exception::from(AgentError::Ledger("`agent_task.status`: DONE".into()));
        assert_eq!(ledger.code, system::INTERNAL_ERROR);
        assert!(!ledger.msg.contains("DONE"));
    }

    #[test]
    fn ledger_errors_are_never_reported_as_database_errors() {
        // 台账层的 `Db` 才是数据库故障；其余（字面量不认识、写回被拒）是内部一致性问题，
        // 混成 6xxxx 会让运维往「数据库坏了」的方向查。
        let from_db =
            AgentError::from(agent::Error::Db(sea_orm::DbErr::RecordNotFound("x".into())));
        assert!(matches!(from_db, AgentError::Database(_)));

        let from_state = AgentError::from(agent::Error::UnknownState {
            column: "agent_task.status",
            literal: "DONE".into(),
        });
        assert!(matches!(from_state, AgentError::Ledger(_)));
    }
}
