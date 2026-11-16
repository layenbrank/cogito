use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[allow(non_snake_case)]
fn toSerialize<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match value {
        Some(s) => {
            let v: serde_json::Value = serde_json::from_str(s).unwrap_or(serde_json::Value::Null);
            v.serialize(serializer)
        }
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "magneticTile")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub index: i32,
    pub title: String,
    pub url: Option<String>,
    pub round: Option<String>,
    pub mark: Option<String>,
    pub component: String,
    pub description: Option<String>,
    pub size: i32,
    pub shape: Shape,
    pub direction: Direction,

    #[serde(serialize_with = "toSerialize")]
    pub background: Option<String>,
    #[serde(serialize_with = "toSerialize")]
    pub backdrop: Option<String>,

    #[serde(rename = "mirrorID")]
    #[sea_orm(column_name = "mirrorID")]
    pub mirror_id: String,

    #[sea_orm(column_name = "textColor")]
    pub text_color: Option<String>,

    #[serde(rename = "collectionID")]
    #[sea_orm(column_name = "collectionID")]
    pub collection_id: Option<String>,

    #[sea_orm(column_name = "downloadCount")]
    pub download_count: i32,

    #[sea_orm(column_name = "archivedAt")]
    pub archived_at: Option<i64>,

    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,

    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Background {
    pub color: Option<String>,
    pub image: Option<String>,
    pub repeat: Option<String>,
    pub size: Option<String>,
    pub position: Option<String>,
    pub attachment: Option<String>,
    pub clip: Option<String>,
    pub blend_mode: Option<String>,
    pub origin: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backdrop {
    pub blur: Option<String>,
    pub brightness: Option<String>,
    pub contrast: Option<String>,
    pub drop_shadow: Option<String>,
    pub grayscale: Option<String>,
    pub hue_rotate: Option<String>,
    pub opacity: Option<String>,
    pub saturate: Option<String>,
    pub sepia: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[serde(rename_all = "lowercase")]
pub enum Shape {
    #[sea_orm(string_value = "square")]
    Square,
    #[sea_orm(string_value = "circle")]
    Circle,
    #[sea_orm(string_value = "rectangle")]
    Rectangle,
}

#[derive(Debug, Clone, PartialEq, Eq, EnumIter, DeriveActiveEnum, Serialize, Deserialize)]
#[sea_orm(rs_type = "String", db_type = "String(StringLen::None)")]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    #[sea_orm(string_value = "vertical")]
    Vertical,
    #[sea_orm(string_value = "horizontal")]
    Horizontal,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "crate::entity::mirror::Entity",
        from = "Column::MirrorId",
        to = "crate::entity::mirror::Column::Id"
    )]
    Mirror,
}

impl Related<crate::entity::mirror::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Mirror.def()
    }
}

#[derive(Iden)]
pub enum MagneticTile {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Read {
    pub id: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub description: Option<String>,
    pub size: Option<i32>,
    pub shape: Option<Shape>,
    pub direction: Option<Direction>,

    #[serde(rename = "mirrorID")]
    pub mirror_id: Option<String>,

    #[serde(rename = "downloadCount")]
    pub download_count: Option<i32>,

    #[serde(rename = "updatedAt")]
    pub updated_at: Option<i64>,

    #[serde(rename = "collectionID")]
    pub collection_id: Option<String>,
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
    /// 不传（`null`/缺失）则由服务端分配 `MAX(index) + 1`：
    /// 前端自己算号需要先读全表、还得自己排队防重复，服务端在同一事务里算既便宜又无竞争。
    #[serde(default)]
    pub index: Option<i32>,
    pub title: String,
    pub url: Option<String>,
    pub round: Option<String>,
    pub mark: Option<String>,
    pub component: String,
    pub description: Option<String>,
    pub background: Option<Background>,
    pub backdrop: Option<Backdrop>,
    pub size: i32,
    pub shape: Shape,
    pub direction: Direction,

    #[serde(rename = "mirrorID")]
    pub mirror_id: String,

    pub text_color: Option<String>,

    #[serde(rename = "collectionID")]
    pub collection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub index: Option<i32>,
    pub title: Option<String>,
    pub url: Option<String>,
    pub round: Option<String>,
    pub mark: Option<String>,
    pub description: Option<String>,
    pub background: Option<Background>,
    pub backdrop: Option<Backdrop>,
    pub size: Option<i32>,
    pub shape: Option<Shape>,
    pub direction: Option<Direction>,
    #[serde(rename = "mirrorID")]
    pub mirror_id: Option<String>,
    pub text_color: Option<String>,
    /// 三态：缺失 = 不改，`null` = 移出集合（置空），字符串 = 加入该集合。
    ///
    /// serde 默认会把 `null` 和「字段缺失」都收敛成 `None`，那样前端
    /// `change: { collectionID: null }`（移出文件夹）会变成静默空操作。
    #[serde(rename = "collectionID", default, deserialize_with = "deserialize_patch")]
    pub collection_id: Option<Option<String>>,
    pub download_count: Option<i32>,
    pub updated_at: Option<i64>,
    pub created_at: Option<i64>,
}

/// `Option<Option<T>>` 的补丁语义：字段出现（含 `null`）一律是「要改」。
fn deserialize_patch<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(|inner| Some(inner))
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
