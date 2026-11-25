//! 文档索引状态：本地（FTS）与云端（asset + 嵌入模型）两条线的进度。
//!
//! `cloud_model` / `cloud_dimensions` 与当前 embed 配置不一致时，该文档**不参与云端召回**
//! （模型换了向量空间就不可比），但本地检索照旧可用。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "knowledge_index_state")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// JSON 键保持 `docID`。
    #[sea_orm(primary_key, column_name = "docID")]
    #[serde(rename = "docID")]
    pub doc_id: String,
    /// JSON 键保持 `spaceID`。
    #[sea_orm(column_name = "spaceID")]
    #[serde(rename = "spaceID")]
    pub space_id: String,
    /// JSON 键保持 `tenantID`。
    #[sea_orm(column_name = "tenantID")]
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[sea_orm(column_name = "localIndexedAt")]
    pub local_indexed_at: Option<i64>,
    /// 字典 knowledge_cloud_status：001 空闲 … 005 失败
    #[sea_orm(column_name = "cloudStatus")]
    pub cloud_status: String,
    /// JSON 键保持 `cloudAssetID`。
    #[sea_orm(column_name = "cloudAssetID")]
    #[serde(rename = "cloudAssetID")]
    pub cloud_asset_id: Option<String>,
    #[sea_orm(column_name = "cloudAssetHash")]
    pub cloud_asset_hash: Option<String>,
    #[sea_orm(column_name = "cloudModel")]
    pub cloud_model: Option<String>,
    #[sea_orm(column_name = "cloudDimensions")]
    pub cloud_dimensions: Option<i64>,
    #[sea_orm(column_name = "cloudIndexedAt")]
    pub cloud_indexed_at: Option<i64>,
    #[sea_orm(column_name = "lastError")]
    pub last_error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
