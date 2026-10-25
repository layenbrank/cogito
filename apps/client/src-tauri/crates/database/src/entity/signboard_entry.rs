use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "signboard_entry")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[serde(rename = "columnID")]
    pub column_id: String,
    pub title: String,
    pub notes: String,
    pub index: i32,
    pub due_at: Option<i64>,
    pub start_at: Option<i64>,
    #[serde(rename = "reminderID")]
    pub reminder_id: Option<String>,
    pub priority: i32,
    /// 0–100 卡片进度；有子任务时由清单同步
    #[serde(default)]
    pub progress: i32,
    pub color: Option<String>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::signboard_column::Entity",
        from = "Column::ColumnId",
        to = "super::signboard_column::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Column,
    #[sea_orm(
        belongs_to = "super::reminder::Entity",
        from = "Column::ReminderId",
        to = "super::reminder::Column::Id",
        on_delete = "SetNull",
        on_update = "Cascade"
    )]
    Reminder,
}

impl Related<super::signboard_column::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Column.def()
    }
}

impl Related<super::reminder::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Reminder.def()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    #[serde(rename = "columnID")]
    pub column_id: Option<String>,
    pub title: Option<String>,
    #[serde(rename = "reminderID")]
    pub reminder_id: Option<String>,
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
    #[serde(rename = "columnID")]
    pub column_id: String,
    pub title: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub index: i32,
    pub due_at: Option<i64>,
    pub start_at: Option<i64>,
    #[serde(rename = "reminderID")]
    pub reminder_id: Option<String>,
    #[serde(default)]
    pub priority: i32,
    #[serde(default)]
    pub progress: i32,
    pub color: Option<String>,
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
    #[serde(rename = "columnID")]
    pub column_id: Option<String>,
    pub title: Option<String>,
    pub notes: Option<String>,
    pub index: Option<i32>,
    pub due_at: Option<Option<i64>>,
    pub start_at: Option<Option<i64>>,
    #[serde(rename = "reminderID")]
    pub reminder_id: Option<Option<String>>,
    pub priority: Option<i32>,
    pub progress: Option<i32>,
    pub color: Option<Option<String>>,
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
