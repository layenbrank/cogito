use sea_orm::entity::prelude::*;

/// 用量计量（追加型，无外键，避免模型/租户删除影响历史数据）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gateway_usage")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", nullable, indexed)]
    pub tenant_id: Option<Uuid>,
    #[sea_orm(column_name = "userID", indexed)]
    pub user_id: Uuid,
    #[sea_orm(column_name = "providerID")]
    pub provider_id: Uuid,
    #[sea_orm(column_name = "modelID", indexed)]
    pub model_id: Uuid,
    #[sea_orm(column_name = "promptTokens")]
    pub prompt_tokens: i64,
    #[sea_orm(column_name = "completionTokens")]
    pub completion_tokens: i64,
    #[sea_orm(column_name = "totalTokens")]
    pub total_tokens: i64,
    /// OK / QUOTA / UPSTREAM / ERROR
    #[sea_orm(column_type = "Text")]
    pub status: String,
    #[sea_orm(column_name = "latencyMs")]
    pub latency_ms: i64,
    #[sea_orm(column_name = "createdAt", indexed)]
    pub created_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
