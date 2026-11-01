use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_item")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub value: String,
    #[sea_orm(unique, column_type = "Text")]
    pub key: String,
    #[sea_orm(column_type = "Text")]
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    #[sea_orm(column_type = "Text", nullable)]
    pub meta: Option<String>,
    pub revision: i32,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
