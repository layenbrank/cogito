use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "auth")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(unique, column_type = "Text")]
    pub username: String,
    #[sea_orm(column_type = "Text")]
    pub password: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub email: Option<String>,
    #[sea_orm(column_type = "Text", nullable, unique)]
    pub phone: Option<String>,
    pub age: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub gender: Option<String>,
    pub birthday: Option<Date>,
    #[sea_orm(nullable)]
    pub avatar: Option<Uuid>,
    /// USER / ADMIN
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
        from = "avatar",
        to = "id",
        relation_enum = "Avatar",
        on_update = "Cascade",
        on_delete = "SetNull"
    )]
    pub avatar_asset: HasOne<super::asset::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
