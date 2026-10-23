use sea_orm::entity::prelude::*;

/// RAG 索引任务的台账（一行一次索引）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "rag_index_task")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 发起人；服务身份（无会话）触发时为 NULL
    #[sea_orm(column_name = "userID", nullable)]
    pub user_id: Option<Uuid>,
    /// 被索引的资产
    #[sea_orm(column_name = "assetID", indexed)]
    pub asset_id: Uuid,
    /// RUNNING / SUCCEEDED / FAILED（词汇定义在 crates/rag）
    #[sea_orm(column_type = "Text")]
    pub status: String,
    /// 编排实例标识（`rag-index-{id}`）
    #[sea_orm(column_name = "instanceID", column_type = "Text")]
    pub instance_id: String,
    /// 终态输出快照（IndexAssetOutput）
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub result: Option<Json>,
    /// 终态失败原因
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
