use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "signboard_automation")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[serde(rename = "boardID")]
    pub board_id: String,
    pub title: String,
    pub enabled: bool,
    pub trigger: String,
    pub condition_json: String,
    pub action_json: String,
    pub index: i32,
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
}

impl Related<super::signboard::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Board.def()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    #[serde(rename = "boardID")]
    pub board_id: Option<String>,
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
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub trigger: String,
    #[serde(default = "default_condition")]
    pub condition_json: String,
    #[serde(default = "default_action")]
    pub action_json: String,
    #[serde(default)]
    pub index: i32,
}

fn default_enabled() -> bool {
    true
}

fn default_condition() -> String {
    "{}".to_string()
}

fn default_action() -> String {
    "[]".to_string()
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
    pub enabled: Option<bool>,
    pub trigger: Option<String>,
    pub condition_json: Option<String>,
    pub action_json: Option<String>,
    pub index: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
