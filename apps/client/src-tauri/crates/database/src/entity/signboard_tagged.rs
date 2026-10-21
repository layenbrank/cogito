use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "signboard_tagged")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[serde(rename = "entryID")]
    pub entry_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    #[serde(rename = "tagID")]
    pub tag_id: String,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::signboard_entry::Entity",
        from = "Column::EntryId",
        to = "super::signboard_entry::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Entry,
    #[sea_orm(
        belongs_to = "super::signboard_tag::Entity",
        from = "Column::TagId",
        to = "super::signboard_tag::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Tag,
}

impl Related<super::signboard_entry::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Entry.def()
    }
}

impl Related<super::signboard_tag::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Tag.def()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    #[serde(rename = "entryID")]
    pub entry_id: Option<String>,
    #[serde(rename = "tagID")]
    pub tag_id: Option<String>,
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
    #[serde(rename = "entryID")]
    pub entry_id: String,
    #[serde(rename = "tagID")]
    pub tag_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remove {
    #[serde(rename = "entryID")]
    pub entry_id: String,
    #[serde(rename = "tagID")]
    pub tag_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(Remove),
    Many(Vec<Remove>),
}
