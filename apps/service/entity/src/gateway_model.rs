use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "gateway_model")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "providerID")]
    pub provider_id: Uuid,
    /// 租户级模型；NULL = 平台默认
    #[sea_orm(column_name = "tenantID", nullable, indexed)]
    pub tenant_id: Option<Uuid>,
    /// 模型标识（如 gpt-4o）
    #[sea_orm(column_type = "Text")]
    pub name: String,
    /// 展示名
    #[sea_orm(column_type = "Text")]
    pub label: String,
    /// 允许调用的角色数组（JSON 字符串数组）；空 = 全角色放行
    #[sea_orm(column_name = "allowRoles", column_type = "JsonBinary", nullable)]
    pub allow_roles: Option<Json>,
    pub enabled: bool,
    /// 模型级日 token 配额；0 = 继承租户
    #[sea_orm(column_name = "dailyTokenQuota")]
    pub daily_token_quota: i64,
    /// 能力声明 `{ tools, reasoning, vision }`；NULL = 未声明（客户端按默认处理）
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub capabilities: Option<Json>,
    /// 上下文窗口（token）；NULL = 未知
    #[sea_orm(column_name = "contextWindow", nullable)]
    pub context_window: Option<i64>,
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
        from = "provider_id",
        to = "id",
        relation_enum = "Provider",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub provider: HasOne<super::gateway_provider::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
