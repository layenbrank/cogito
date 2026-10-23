use sea_orm::entity::prelude::*;

/// 事务性发件箱（追加型，无外键：事件是历史事实，不随聚合级联删除）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "outbox")]
pub struct Model {
    /// 事件 ID，同时是下游消费者的幂等去重键
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 数据库分配的全序序号，发布游标只依赖它（时间戳可能并列或回拨）。
    /// 插入时保持 `NotSet` 交由数据库赋值。
    #[sea_orm(column_name = "seq")]
    pub seq: i64,
    /// 聚合名，如 `subscription`
    #[sea_orm(column_type = "Text", indexed)]
    pub aggregate: String,
    #[sea_orm(column_name = "aggregateID", indexed)]
    pub aggregate_id: Uuid,
    /// 不可变过去式事件名，如 `subscription.renewed`
    #[sea_orm(column_name = "eventType", column_type = "Text")]
    pub event_type: String,
    #[sea_orm(column_name = "schemaVersion")]
    pub schema_version: i32,
    /// 事件负载快照，消费者不得回查写入方的当前状态
    #[sea_orm(column_type = "JsonBinary")]
    pub payload: Json,
    /// W3C traceparent，用于跨服务续链
    #[sea_orm(column_type = "Text", nullable)]
    pub traceparent: Option<String>,
    #[sea_orm(column_name = "tenantID", nullable, indexed)]
    pub tenant_id: Option<Uuid>,
    #[sea_orm(column_name = "createdAt", indexed)]
    pub created_at: DateTimeWithTimeZone,
    /// NULL 表示尚未发布
    #[sea_orm(column_name = "publishedAt", nullable, indexed)]
    pub published_at: Option<DateTimeWithTimeZone>,
    /// 已投递尝试次数（可观测：一直失败的事件在库里会持续增长）
    pub attempts: i32,
    /// 最近一次投递失败的原因；发布成功时清空
    #[sea_orm(column_name = "lastError", column_type = "Text", nullable)]
    pub last_error: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
