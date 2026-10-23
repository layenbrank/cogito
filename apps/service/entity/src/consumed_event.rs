use sea_orm::entity::prelude::*;

/// 消费幂等去重（追加型）：同一消费者对同一事件最多处理一次。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "consumed_event")]
pub struct Model {
    /// 消费者标识（服务名或进程组），与事件 ID 共同构成幂等键
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub consumer: String,
    #[sea_orm(primary_key, auto_increment = false, column_name = "eventID")]
    pub event_id: Uuid,
    #[sea_orm(column_name = "consumedAt")]
    pub consumed_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
