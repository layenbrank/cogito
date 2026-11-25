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
    /// JSON 键保持 `spaceID`。
    #[sea_orm(column_name = "spaceID")]
    #[serde(rename = "spaceID")]
    pub space_id: String,
    pub title: String,
    /// 相对 space `root_path` 的路径（`a/b.md`）
    #[sea_orm(column_name = "relPath")]
    pub rel_path: String,
    /// 正文指纹（长度 + FNV-1a），跨端不通用，只做本地「文件是否变过」判断
    pub hash: String,
    /// 正文快照；检索与摘要都读它，写回以文件为准
    pub content: String,
    pub size: i64,
    #[sea_orm(column_name = "wordCount")]
    pub word_count: i64,
    /// 每次落库 +1，前端据此判断「我手里的版本过期了」
    pub revision: i64,
    /// 字典 knowledge_doc_status：001 草稿 / 002 已发布
    pub status: String,
    /// 字典 knowledge_doc_source：001 手动 / 002 智能体 / 003 导入 / 004 编辑撰写
    pub source: String,
    pub error: Option<String>,
    /// JSON 键保持 `sessionID`。
    #[sea_orm(column_name = "sessionID")]
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    /// JSON 键保持 `assetID`。
    #[sea_orm(column_name = "assetID")]
    #[serde(rename = "assetID")]
    pub asset_id: Option<String>,
    #[sea_orm(column_name = "assetHash")]
    pub asset_hash: Option<String>,
    #[sea_orm(column_name = "archivedAt")]
    pub archived_at: Option<i64>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
