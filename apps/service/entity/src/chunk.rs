use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "chunk")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "assetID", indexed)]
    pub asset_id: Uuid,
    /// 分片序号（从 0 开始）
    pub index: i32,
    /// 分片内容 SHA-256（CAS key）
    #[sea_orm(column_type = "Text", indexed)]
    pub hash: String,
    pub size: i64,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(
        belongs_to,
        from = "asset_id",
        to = "id",
        relation_enum = "Asset",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub asset: HasOne<super::asset::Entity>,
    #[sea_orm(
        belongs_to,
        from = "creator",
        to = "id",
        relation_enum = "Creator",
        on_update = "Cascade",
        on_delete = "SetNull"
    )]
    pub created_by: HasOne<super::auth::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
