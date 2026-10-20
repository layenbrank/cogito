use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "bookmark")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,

    #[serde(rename = "mirrorID")]
    #[sea_orm(column_name = "mirrorID")]
    pub mirror_id: String,

    #[serde(rename = "parentID")]
    #[sea_orm(column_name = "parentID")]
    pub parent_id: Option<String>,

    pub title: String,
    pub url: Option<String>,
    pub index: i32,

    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,

    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    #[serde(rename = "mirrorID")]
    pub mirror_id: Option<String>,
    #[serde(rename = "parentID")]
    pub parent_id: Option<Option<String>>,
    pub url: Option<String>,
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
    #[serde(rename = "mirrorID")]
    pub mirror_id: String,
    #[serde(rename = "parentID")]
    pub parent_id: Option<String>,
    pub title: String,
    pub url: Option<String>,
    #[serde(default)]
    pub index: i32,
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
    pub title: Option<String>,
    pub url: Option<Option<String>>,
    #[serde(rename = "parentID")]
    pub parent_id: Option<Option<String>>,
    pub index: Option<i32>,
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

/// 导入树节点（与前端 BookmarkNode 对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNode {
    pub title: String,
    pub url: Option<String>,
    #[serde(default)]
    pub children: Vec<ImportNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportP {
    #[serde(rename = "mirrorID")]
    pub mirror_id: String,
    /// skip | overwrite
    pub strategy: String,
    pub roots: Vec<ImportNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportR {
    pub inserted: i32,
    pub skipped: i32,
    pub updated: i32,
}
