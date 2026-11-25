//! 空间（一个 space = 一个目录 + 一批文档）。
//!
//! `scope` 为字典 knowledge_space_scope（001 个人 / 002 租户，用 `tenantID` 圈定）。
//! 正文永远以文件为准，`knowledge_doc.content` 只是快照。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "knowledge_space")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    /// 目录名：`<root>/<slug>/`，全库唯一
    pub slug: String,
    pub description: Option<String>,
    /// 字典 knowledge_space_scope：001 个人 / 002 租户
    pub scope: String,
    /// 序列化键与列名同为 `tenantID`。
    #[sea_orm(column_name = "tenantID")]
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    /// 该 space 的文件根目录（绝对路径）
    #[sea_orm(column_name = "rootPath")]
    pub root_path: String,
    #[sea_orm(column_name = "autoUpdate")]
    pub auto_update: bool,
    #[sea_orm(column_name = "autoExport")]
    pub auto_export: bool,
    /// 生成内容是否带 `[doc:title#ordinal]` 引用
    pub citation: bool,
    #[sea_orm(column_name = "cloudModel")]
    pub cloud_model: Option<String>,
    #[sea_orm(column_name = "cloudDimensions")]
    pub cloud_dimensions: Option<i64>,
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
