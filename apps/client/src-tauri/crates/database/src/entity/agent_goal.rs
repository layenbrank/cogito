#![allow(non_snake_case)]

//! 会话级目标档案：**一行一个会话**（`sessionID` 唯一索引）。
//!
//! 目标推进（自动续跑）的全部状态都在这里：轮次预算 / 已用轮次 / 自报进度 /
//! 生命周期状态，以及启动前被我们改掉的审批档（`approvalBefore`）。
//! 以前这些都在模块级 `Map` 里，刷新即丢，审批档甚至永远停在 `auto`。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

fn default_budget() -> i64 {
    6
}

fn default_status() -> String {
    "running".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_goal")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "sessionID")]
    pub sessionID: String,
    /// 横幅用的短摘要（≤120 字）
    pub summary: String,
    /// 原始 prompt（续跑指令里原样带上，避免长上下文漂移）
    pub detail: String,
    pub budget: i64,
    pub used: i64,
    #[sea_orm(column_name = "progressDone")]
    pub progressDone: Option<i64>,
    #[sea_orm(column_name = "progressTotal")]
    pub progressTotal: Option<i64>,
    /// running | paused | done | exhausted
    pub status: String,
    /// 启动前被改掉的审批档：ask | auto | readonly
    #[sea_orm(column_name = "approvalBefore")]
    pub approvalBefore: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    pub sessionID: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ReadP {
    One(Read),
    Many(Vec<Read>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Write {
    pub id: Option<String>,
    pub sessionID: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default = "default_budget")]
    pub budget: i64,
    #[serde(default)]
    pub used: i64,
    #[serde(default)]
    pub progressDone: Option<i64>,
    #[serde(default)]
    pub progressTotal: Option<i64>,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub approvalBefore: Option<String>,
    pub createdAt: Option<i64>,
    pub updatedAt: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub summary: Option<String>,
    pub detail: Option<String>,
    pub budget: Option<i64>,
    pub used: Option<i64>,
    pub progressDone: Option<Option<i64>>,
    pub progressTotal: Option<Option<i64>>,
    pub status: Option<String>,
    pub approvalBefore: Option<Option<String>>,
    pub updatedAt: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    pub key: String,
    pub change: Change,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum UpdateP {
    One(Update),
    Many(Vec<Update>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RemoveP {
    One(String),
    Many(Vec<String>),
}
