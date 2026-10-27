#![allow(non_snake_case)]

//! 知识库（一个 base = 一个目录 + 一批文档）。
//!
//! `scope=user` 属个人；`scope=tenant` 为团队共享（用 `tenantId` 圈定租户）。
//! 正文永远以文件为准，`knowledge_doc.content` 只是快照。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "knowledge_base")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    /// 目录名：`<root>/<slug>/`，全库唯一
    pub slug: String,
    pub description: Option<String>,
    /// user | tenant
    pub scope: String,
    #[sea_orm(column_name = "tenantId")]
    pub tenantID: Option<String>,
    /// 该 base 的文件根目录（绝对路径）
    #[sea_orm(column_name = "rootPath")]
    pub rootPath: String,
    #[sea_orm(column_name = "autoUpdate")]
    pub autoUpdate: bool,
    #[sea_orm(column_name = "autoExport")]
    pub autoExport: bool,
    /// 生成内容是否带 `[doc:title#ordinal]` 引用
    pub citation: bool,
    #[sea_orm(column_name = "cloudModel")]
    pub cloudModel: Option<String>,
    #[sea_orm(column_name = "cloudDimensions")]
    pub cloudDimensions: Option<i64>,
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
