use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 智能相簿：只存规则（`FilterState` 的版本化 JSON），结果实时算。
///
/// 不把结果落库 —— 照片一进来、评级一变，规则结果自然会变；存快照只会制造不一致。
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "gallerySmartAlbum")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    /// `{"v":1,...}`：`FilterState` 的 JSON
    pub query: String,
    pub index: i64,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
