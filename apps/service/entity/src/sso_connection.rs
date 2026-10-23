use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "sso_connection")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID")]
    pub tenant_id: Uuid,
    /// oidc / saml（saml 预留）
    #[sea_orm(column_type = "Text")]
    pub provider: String,
    #[sea_orm(column_type = "Text")]
    pub issuer: String,
    #[sea_orm(column_name = "clientID", column_type = "Text")]
    pub client_id: String,
    /// client secret，AES-256-GCM 密文
    #[sea_orm(column_name = "clientSecretEnc", column_type = "Text")]
    pub client_secret_enc: String,
    #[sea_orm(column_name = "redirectUri", column_type = "Text")]
    pub redirect_uri: String,
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
}

impl ActiveModelBehavior for ActiveModel {}
