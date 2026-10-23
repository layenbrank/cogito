use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "tenant")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    #[sea_orm(column_type = "Text", unique)]
    pub slug: String,
    /// ACTIVE / DISABLED
    #[sea_orm(column_type = "Text")]
    pub status: String,
    /// PERSONAL（个人，走免费/订阅档位）/ TEAM（团队，走全局兜底）
    #[sea_orm(column_name = "type", column_type = "Text")]
    pub tenant_type: String,
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
