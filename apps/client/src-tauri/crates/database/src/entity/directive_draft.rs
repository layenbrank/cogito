#![allow(non_snake_case)]

//! 指令草稿收件箱：agent 生成的指令先落这里，用户确认后才经 corex daemon 写入 `corex.db`。
//!
//! 与 corex 的指令库**不共享存储**：corex.db 的唯一写者是 corex-daemon，客户端只有 IPC；
//! 本表只保存「待确认草稿」，因此可随时丢弃而不影响线上指令。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "directive_draft")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "threadId")]
    pub threadID: Option<String>,
    #[sea_orm(column_name = "workspaceId")]
    pub workspaceID: Option<String>,
    pub name: String,
    /// 指令定义 JSON（与指令编辑器文档同形）
    pub definition: String,
    /// 字典 directive_draft_status：001 待确认 / 002 已保存 / 003 已丢弃
    pub status: String,
    pub error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}
