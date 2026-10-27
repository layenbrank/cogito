#![allow(non_snake_case)]

//! 知识库文档的元数据 + 正文快照。
//!
//! 不变量：**文件为准**。`hash/content` 用来判断「文件被外部改过」，并由触发器
//! 同步到 `knowledge_doc_fts`（FTS5 external content）。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "knowledge_doc")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "baseId")]
    pub baseID: String,
    pub title: String,
    /// 相对 base rootPath 的路径（`a/b.md`）
    #[sea_orm(column_name = "relPath")]
    pub relPath: String,
    /// 正文指纹（长度 + FNV-1a），跨端不通用，只做本地「文件是否变过」判断
    pub hash: String,
    /// 正文快照；检索与摘要都读它，写回以文件为准
    pub content: String,
    pub size: i64,
    #[sea_orm(column_name = "wordCount")]
    pub wordCount: i64,
    /// 每次落库 +1，前端据此判断「我手里的版本过期了」
    pub revision: i64,
    /// published | draft
    pub status: String,
    /// manual | agent | import
    pub source: String,
    pub error: Option<String>,
    #[sea_orm(column_name = "sessionId")]
    pub sessionID: Option<String>,
    #[sea_orm(column_name = "assetId")]
    pub assetID: Option<String>,
    #[sea_orm(column_name = "assetHash")]
    pub assetHash: Option<String>,
    #[sea_orm(column_name = "archivedAt")]
    pub archivedAt: Option<i64>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
