use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 相簿归属：`metadata.albums` 数组升级成关系表。
///
/// 为什么必须升级：图库要做「相簿计数」「按相簿过滤」「相簿名参与检索」，
/// 塞在 asset 的 JSON 里既不能索引也没法聚合。`metadata.albums` 只作为一次性回填源保留。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "galleryAlbumAsset")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "assetID")]
    #[serde(rename = "assetID")]
    pub asset_id: String,

    #[sea_orm(primary_key, auto_increment = false, column_name = "albumID")]
    #[serde(rename = "albumID")]
    pub album_id: String,

    #[sea_orm(column_name = "addedAt")]
    pub added_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::asset::Entity",
        from = "Column::AssetId",
        to = "super::asset::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Asset,
    #[sea_orm(
        belongs_to = "super::album::Entity",
        from = "Column::AlbumId",
        to = "super::album::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Album,
}

impl Related<super::asset::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Asset.def()
    }
}

impl Related<super::album::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Album.def()
    }
}
