use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gateway_provider")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 租户级供应商；NULL = 平台默认
    #[sea_orm(column_name = "tenantID", nullable, indexed)]
    pub tenant_id: Option<Uuid>,
    /// openai / anthropic / deepseek / qwen / zhipu / ollama
    #[sea_orm(column_type = "Text")]
    pub kind: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_name = "baseURL", column_type = "Text")]
    pub base_url: String,
    /// 上游 API Key，AES-256-GCM 密文；空 = 无密钥（如 ollama）
    #[sea_orm(column_name = "apiKeyEnc", column_type = "Text")]
    pub api_key_enc: String,
    /// ACTIVE / DISABLED
    #[sea_orm(column_type = "Text")]
    pub status: String,
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
    #[sea_orm(column_name = "expiresAt", nullable)]
    pub expires_at: Option<DateTimeWithTimeZone>,
}

impl ActiveModelBehavior for ActiveModel {}
