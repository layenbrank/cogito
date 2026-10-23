use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "subscription")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 档位名，对应 `gateway.plan_daily_token_quota` 的 key
    #[sea_orm(column_type = "Text")]
    pub plan: String,
    /// ACTIVE / CANCELED
    #[sea_orm(column_type = "Text")]
    pub status: String,
    /// 到期时间；NULL = 永久有效（生效时间 = `createdAt`）
    #[sea_orm(column_name = "expiresAt", nullable)]
    pub expires_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
