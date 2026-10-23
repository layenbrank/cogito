//! 事件内核的失败原因。

/// 事件读写与发布过程中可能出现的错误。
///
/// 「投递失败」不在这里：单条事件的投递失败不中断一轮发布，由
/// [`PublishOutcome`](crate::PublishOutcome) 逐条回报。
#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    /// 数据库访问失败。
    #[error("数据库访问失败：{0}")]
    Db(#[from] sea_orm::DbErr),
    /// 事件类型不合法。
    #[error("事件类型不合法（应为 `<聚合>.<过去式动词>`，例如 `subscription.renewed`）：{0}")]
    InvalidEventType(String),
}
