#![allow(non_snake_case)]

//! 文档索引状态：本地（FTS）与云端（asset + 嵌入模型）两条线的进度。
//!
//! `cloudModel/cloudDimensions` 与当前 embed 配置不一致时，该文档**不参与云端召回**
//! （模型换了向量空间就不可比），但本地检索照旧可用。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "knowledge_index_state")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, column_name = "docId")]
    pub docID: String,
    #[sea_orm(column_name = "baseId")]
    pub baseID: String,
    #[sea_orm(column_name = "tenantId")]
    pub tenantID: Option<String>,
    #[sea_orm(column_name = "localIndexedAt")]
    pub localIndexedAt: Option<i64>,
    /// idle | pending | running | succeeded | failed
    #[sea_orm(column_name = "cloudStatus")]
    pub cloudStatus: String,
    #[sea_orm(column_name = "cloudAssetId")]
    pub cloudAssetID: Option<String>,
    #[sea_orm(column_name = "cloudAssetHash")]
    pub cloudAssetHash: Option<String>,
    #[sea_orm(column_name = "cloudModel")]
    pub cloudModel: Option<String>,
    #[sea_orm(column_name = "cloudDimensions")]
    pub cloudDimensions: Option<i64>,
    #[sea_orm(column_name = "cloudIndexedAt")]
    pub cloudIndexedAt: Option<i64>,
    #[sea_orm(column_name = "lastError")]
    pub lastError: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
