#![allow(non_snake_case)]

//! 租户级字典覆盖（本地缓存远端 catalog）。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "dict_tenant_item")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "tenantId")]
    pub tenantId: String,
    #[sea_orm(primary_key, auto_increment = false)]
    #[sea_orm(column_name = "typeCode")]
    pub typeCode: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub value: String,
    pub label: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
