use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tenant_member")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID")]
    pub tenant_id: Uuid,
    #[sea_orm(column_name = "userID")]
    pub user_id: Uuid,
    /// OWNER / ADMIN / MEMBER
    #[sea_orm(column_type = "Text")]
    pub role: String,
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
    #[sea_orm(
        belongs_to,
        from = "tenant_id",
        to = "id",
        relation_enum = "Tenant",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub tenant: HasOne<super::tenant::Entity>,
    #[sea_orm(
        belongs_to,
        from = "user_id",
        to = "id",
        relation_enum = "User",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub user: HasOne<super::auth::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
