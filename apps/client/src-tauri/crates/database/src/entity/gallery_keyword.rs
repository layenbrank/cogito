use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 关键词三角色：`people`（人）/ `places`（地）/ `themes`（题材）。
///
/// 只给 3 星以上加（Bridge 的做法），降低维护成本；三分类固定，不做自由标签树。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "galleryKeyword")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_name = "assetID")]
    #[serde(rename = "assetID")]
    pub asset_id: String,

    #[sea_orm(primary_key, auto_increment = false)]
    pub facet: String,

    #[sea_orm(primary_key, auto_increment = false)]
    pub value: String,
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
}

impl Related<super::asset::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Asset.def()
    }
}
