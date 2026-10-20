use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "signboardCardTag")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[serde(rename = "cardID")]
    #[sea_orm(column_name = "cardID")]
    pub card_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    #[serde(rename = "tagID")]
    #[sea_orm(column_name = "tagID")]
    pub tag_id: String,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::signboard_card::Entity",
        from = "Column::CardId",
        to = "super::signboard_card::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Card,
    #[sea_orm(
        belongs_to = "super::signboard_tag::Entity",
        from = "Column::TagId",
        to = "super::signboard_tag::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Tag,
}

impl Related<super::signboard_card::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Card.def()
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
    #[serde(rename = "cardID")]
    pub card_id: Option<String>,
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
    #[serde(rename = "cardID")]
    pub card_id: String,
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
    #[serde(rename = "cardID")]
    pub card_id: String,
    #[serde(rename = "tagID")]
    pub tag_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(Remove),
    Many(Vec<Remove>),
}
