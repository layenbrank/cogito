#![allow(non_snake_case)]

//! 字典项：稳定 `value`（001/002/…）+ 可改 `label`。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_item")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(column_name = "typeCode")]
    pub typeCode: String,
    /// 三位数字串，业务分支只认此字段
    pub value: String,
    pub label: String,
    pub sort: i32,
    pub enabled: bool,
    #[sea_orm(column_name = "isDefault")]
    pub isDefault: bool,
    /// 可选 JSON：色/图标/是否终态等
    pub meta: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::dict_type::Entity",
        from = "Column::TypeCode",
        to = "super::dict_type::Column::Code"
    )]
    Type,
}

impl Related<super::dict_type::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Type.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
