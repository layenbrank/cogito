use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_tenant_item")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "tenantID")]
    pub tenant_id: Uuid,
    #[sea_orm(primary_key, auto_increment = false, column_name = "typeCode", column_type = "Text")]
    pub type_code: String,
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub value: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub label: Option<String>,
    pub enabled: Option<bool>,
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
        from = "type_code",
        to = "code",
        relation_enum = "DictType",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub dict_type: HasOne<super::dict_type::Entity>,
    #[sea_orm(
        belongs_to,
        from = "value",
        to = "value",
        relation_enum = "DictItem",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    pub dict_item: HasOne<super::dict_item::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
