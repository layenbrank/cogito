use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "album")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    pub index: i64,
    #[sea_orm(column_name = "coverAssetID")]
    pub cover_asset_id: Option<String>,
    pub status: String,
    #[sea_orm(column_name = "archivedAt")]
    pub archived_at: Option<i64>,
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
    pub name: Option<String>,
    #[serde(default)]
    pub archived: bool,
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
    pub name: String,
    #[serde(default)]
    pub index: i64,
    pub cover_asset_id: Option<String>,
    pub status: Option<String>,
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
    pub name: Option<String>,
    pub index: Option<i64>,
    pub cover_asset_id: Option<Option<String>>,
    pub status: Option<String>,
    pub archived_at: Option<Option<i64>>,
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
