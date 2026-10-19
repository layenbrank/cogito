use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

/// 库内 JSON 文本在返回前端时还原成对象，避免 `background.color` 读不到。
fn serialize_json_text<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(text) => {
            let parsed: serde_json::Value =
                serde_json::from_str(text).unwrap_or(serde_json::Value::Null);
            parsed.serialize(serializer)
        }
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "mirror")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub title: String,
    pub index: i32,
    pub mark: String,
    pub description: String,
    pub overlay: String,
    #[serde(serialize_with = "serialize_json_text")]
    pub background: Option<String>,
    #[serde(serialize_with = "serialize_json_text")]
    pub backdrop: Option<String>,

    #[sea_orm(column_name = "archivedAt")]
    pub archived_at: Option<i64>,

    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,

    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Background {
    color: Option<String>,
    image: Option<String>,
    repeat: Option<String>,
    size: Option<String>,
    position: Option<String>,
    attachment: Option<String>,
    clip: Option<String>,
    blend_mode: Option<String>,
    origin: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Backdrop {
    blur: Option<String>,
    brightness: Option<String>,
    contrast: Option<String>,
    drop_shadow: Option<String>,
    grayscale: Option<String>,
    hue_rotate: Option<String>,
    opacity: Option<String>,
    saturate: Option<String>,
    sepia: Option<String>,
    url: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "crate::entity::magnetic_tile::Entity")]
    MagneticTile,
}

impl Related<crate::entity::magnetic_tile::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MagneticTile.def()
    }
}

// ==================== DTO ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Write {
    pub index: i32,
    pub title: String,
    pub mark: String,
    pub description: String,
    pub overlay: String,
    pub background: Option<Background>,
    pub backdrop: Option<Backdrop>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    pub title: Option<String>,
    pub mark: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReadP {
    One(Read),
    Many(Vec<Read>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub index: Option<i32>,
    pub title: Option<String>,
    pub mark: Option<String>,
    pub description: Option<String>,
    pub overlay: Option<String>,
    pub background: Option<Background>,
    pub backdrop: Option<Backdrop>,
    pub updated_at: Option<i64>,
    pub created_at: Option<i64>,
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
