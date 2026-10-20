use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "console_preference")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 一名 ADMIN 一行
    #[sea_orm(unique, column_name = "userID")]
    pub user_id: Uuid,
    #[sea_orm(column_name = "navOrder", column_type = "JsonBinary")]
    pub nav_order: Json,
    #[sea_orm(column_name = "pinnedNav", column_type = "JsonBinary")]
    pub pinned_nav: Json,
    #[sea_orm(column_name = "dashboardWidgets", column_type = "JsonBinary")]
    pub dashboard_widgets: Json,
    #[sea_orm(column_type = "JsonBinary")]
    pub bookmarks: Json,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
