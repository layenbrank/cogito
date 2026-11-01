#![allow(non_snake_case)]

//! 全局字典池：稳定 `value`（001..）+ 稳定 `key`（DRAFT / ACTIVE / ARCHIVED / …）。
//! 同一 value 可被多个 type 认领（见 dict_type_item）。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_item")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// 三位数字串，全局唯一
    pub value: String,
    /// 业务分支稳定标识
    pub key: String,
    pub label: Option<String>,
    pub sort: i32,
    pub enabled: bool,
    /// 可选 JSON：色/图标/是否终态等
    pub meta: Option<String>,
    pub revision: i32,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::dict_type_item::Entity")]
    TypeClaims,
}

impl Related<super::dict_type_item::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TypeClaims.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
