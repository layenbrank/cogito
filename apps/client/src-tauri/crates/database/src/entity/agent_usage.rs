#![allow(non_snake_case)]

use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_usage")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    /// 运行 id：同一次运行重复写入要能认出是同一条
    #[sea_orm(column_name = "runID", unique)]
    pub runID: String,
    #[sea_orm(column_name = "sessionID")]
    pub sessionID: Option<String>,
    #[sea_orm(column_name = "providerID")]
    pub providerID: Option<String>,
    pub model: String,
    #[sea_orm(column_name = "inputTokens")]
    pub inputTokens: i64,
    #[sea_orm(column_name = "outputTokens")]
    pub outputTokens: i64,
    #[sea_orm(column_name = "totalTokens")]
    pub totalTokens: i64,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    pub runID: Option<String>,
    pub sessionID: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReadP {
    One(Read),
    Many(Vec<Read>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Write {
    pub id: Option<String>,
    pub runID: String,
    pub sessionID: Option<String>,
    pub providerID: Option<String>,
    pub model: String,
    pub inputTokens: i64,
    pub outputTokens: i64,
    pub totalTokens: i64,
    pub createdAt: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub sessionID: Option<Option<String>>,
    pub providerID: Option<Option<String>>,
    pub model: Option<String>,
    pub inputTokens: Option<i64>,
    pub outputTokens: Option<i64>,
    pub totalTokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Update {
    pub key: String,
    pub change: Change,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateP {
    One(Update),
    Many(Vec<Update>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(String),
    Many(Vec<String>),
}
