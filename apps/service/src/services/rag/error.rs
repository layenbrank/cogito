//! rag 索引任务的领域错误 → Exception
//!
//! 领域服务返回本枚举而不是 [`Exception`]：状态码与业务码是接口层的知识，写进服务里会让
//! 「同一段校验换一个入口（事件驱动、后台补偿）」就得改业务逻辑。映射只在这一处做。

use uuid::Uuid;

use crate::filters::exception::Exception;
use crate::utils::code::{business, external, system};

/// rag 索引域的领域错误。
#[derive(Debug, thiserror::Error)]
pub enum RagError {
    /// 资产不存在、不可见，或 id 不是合法 uuid。
    ///
    /// 三者合并成同一个错误：分开会让调用方能拿它探测「某个 id 在别的租户存在」。
    #[error("资产不存在")]
    AssetNotFound,
    /// 资产存在但当前不可索引（未完成上传 / 已归档）；文案直接给调用方看。
    #[error("{0}")]
    AssetNotIndexable(String),
    /// 同一资产已有在跑的索引任务；带上已有任务的 id（拿不到时为 `None`）。
    #[error("该资产已有索引任务在运行")]
    AlreadyRunning(Option<Uuid>),
    /// 台账里没有这条任务，或它不在当前租户视野内。
    #[error("索引任务不存在")]
    NotFound,
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

impl From<rag::Error> for RagError {
    fn from(err: rag::Error) -> Self {
        match err {
            rag::Error::Db(source) => Self::Database(source.to_string()),
            // 唯一索引挡住建行 ⇒ 并发提交撞在一起，先查的那一次没看见对方。
            rag::Error::AlreadyRunning => Self::AlreadyRunning(None),
            other => Self::Ledger(other.to_string()),
        }
    }
}

impl From<RagError> for Exception {
    fn from(err: RagError) -> Self {
        match err {
            RagError::AssetNotFound => {
                Exception::custom(business::rag::ASSET_NOT_FOUND, "资产不存在")
            }
            RagError::AssetNotIndexable(msg) => {
                Exception::custom(business::rag::ASSET_NOT_INDEXABLE, msg)
            }
            RagError::AlreadyRunning(task_id) => {
                let body = Exception::custom(
                    business::rag::INDEX_ALREADY_RUNNING,
                    "该资产已有索引任务在运行",
                );
                match task_id {
                    Some(id) => body.with_details(serde_json::json!({ "taskID": id.to_string() })),
                    None => body,
                }
            }
            RagError::NotFound => {
                Exception::custom(business::rag::TASK_NOT_FOUND, "索引任务不存在")
            }
            RagError::OrchestrationUnavailable(msg) => {
                // 调用方看得见「暂时起不了」，排查线索留在日志里。
                tracing::error!(error = %msg, "rag 索引编排不可用");
                Exception::custom(
                    business::rag::ORCHESTRATION_UNAVAILABLE,
                    "编排服务暂时不可用，请稍后重试",
                )
            }
            RagError::Database(msg) => {
                tracing::error!(error = %msg, "rag 索引数据库错误");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            RagError::Ledger(msg) => {
                tracing::error!(error = %msg, "rag 索引台账错误");
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
            (RagError::AssetNotFound, business::rag::ASSET_NOT_FOUND),
            (
                RagError::AssetNotIndexable("还没传完".into()),
                business::rag::ASSET_NOT_INDEXABLE,
            ),
            (
                RagError::AlreadyRunning(None),
                business::rag::INDEX_ALREADY_RUNNING,
            ),
            (RagError::NotFound, business::rag::TASK_NOT_FOUND),
        ];

        for (err, expected) in cases {
            assert_eq!(Exception::from(err).code, expected);
        }
    }

    #[test]
    fn already_running_reports_the_other_task_when_known() {
        let id = Uuid::parse_str("0b0e1e1e-1c1c-4c4c-8c8c-1c1c1c1c1c1c").unwrap();

        let with_id = Exception::from(RagError::AlreadyRunning(Some(id)));
        assert_eq!(
            with_id.details.expect("要带上已有任务")["taskID"],
            serde_json::json!(id.to_string())
        );

        // 撞唯一索引的那条路径拿不到 id：不能因为有 details 这条通道就编一个。
        let race = Exception::from(RagError::AlreadyRunning(None));
        assert!(race.details.is_none());
        assert_eq!(race.code, business::rag::INDEX_ALREADY_RUNNING);
    }

    #[test]
    fn unique_violation_from_the_ledger_becomes_already_running() {
        let err = RagError::from(rag::Error::AlreadyRunning);
        assert!(matches!(err, RagError::AlreadyRunning(None)));
    }

    #[test]
    fn orchestrator_failure_hides_the_internal_reason() {
        let body = Exception::from(RagError::OrchestrationUnavailable(
            "instance rag-index-x: connection refused".into(),
        ));
        assert_eq!(body.code, business::rag::ORCHESTRATION_UNAVAILABLE);
        assert!(!body.msg.contains("connection refused"));
    }

    #[test]
    fn database_and_ledger_errors_map_to_their_families() {
        let db = Exception::from(RagError::Database("relation missing".into()));
        assert_eq!(db.code, external::DATABASE_ERROR);
        assert!(!db.msg.contains("relation"));

        let ledger = Exception::from(RagError::Ledger("`rag_index_task.status`: DONE".into()));
        assert_eq!(ledger.code, system::INTERNAL_ERROR);
        assert!(!ledger.msg.contains("DONE"));
    }

    #[test]
    fn ledger_errors_are_never_reported_as_database_errors() {
        // 台账层的 `Db` 才是数据库故障；其余（字面量不认识、写回被拒）是内部一致性问题，
        // 混成 6xxxx 会让运维往「数据库坏了」的方向查。
        let from_db = RagError::from(rag::Error::Db(sea_orm::DbErr::RecordNotFound("x".into())));
        assert!(matches!(from_db, RagError::Database(_)));

        let from_state = RagError::from(rag::Error::UnknownState {
            column: "rag_index_task.status",
            literal: "DONE".into(),
        });
        assert!(matches!(from_state, RagError::Ledger(_)));
    }
}
