use sea_orm::entity::prelude::*;

/// 安全审计日志（追加型）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gateway_audit")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", nullable)]
    pub tenant_id: Option<Uuid>,
    #[sea_orm(indexed)]
    pub actor: Uuid,
    #[sea_orm(column_type = "Text")]
    pub action: String,
    #[sea_orm(column_type = "Text")]
    pub resource: String,
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub detail: Option<Json>,
    #[sea_orm(column_type = "Text", nullable)]
    pub ip: Option<String>,
    #[sea_orm(column_name = "createdAt", indexed)]
    pub created_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
