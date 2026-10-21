use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "signboard_column")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[serde(rename = "boardID")]
    pub board_id: String,
    pub title: String,
    pub index: i32,
    pub color: Option<String>,
    pub wip_limit: Option<i32>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::signboard::Entity",
        from = "Column::BoardId",
        to = "super::signboard::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Board,
    #[sea_orm(has_many = "super::signboard_entry::Entity")]
    Entries,
}

impl Related<super::signboard::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Board.def()
    }
}

impl Related<super::signboard_entry::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Entries.def()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    #[serde(rename = "boardID")]
    pub board_id: Option<String>,
    pub title: Option<String>,
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
    #[serde(rename = "boardID")]
    pub board_id: String,
    pub title: String,
    #[serde(default)]
    pub index: i32,
    pub color: Option<String>,
    pub wip_limit: Option<i32>,
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
    pub index: Option<i32>,
    pub color: Option<Option<String>>,
    pub wip_limit: Option<Option<i32>>,
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
