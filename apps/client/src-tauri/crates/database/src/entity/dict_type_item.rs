#![allow(non_snake_case)]

//! type 对全局池 value 的认领（claim）。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_type_item")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_name = "typeCode")]
    pub typeCode: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub value: String,
    pub label: Option<String>,
    #[sea_orm(column_name = "isDefault")]
    pub isDefault: bool,
    pub sort: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::dict_type::Entity",
        from = "Column::TypeCode",
        to = "super::dict_type::Column::Code"
    )]
    Type,
    #[sea_orm(
        belongs_to = "super::dict_item::Entity",
        from = "Column::Value",
        to = "super::dict_item::Column::Value"
    )]
    PoolItem,
}

impl Related<super::dict_type::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Type.def()
    }
}

impl Related<super::dict_item::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PoolItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
