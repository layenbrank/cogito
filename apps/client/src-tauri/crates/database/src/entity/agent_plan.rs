#![allow(non_snake_case)]

//! 会话级计划档案：**一行一个会话**（`sessionID` 唯一索引）。
//!
//! 为什么单独成表而不是塞进偏好文件：`body` 是数 KB 级的计划全文，写进
//! `agent.json` 会连带整包读写一起变胖；独立表还能按 `updatedAt` 裁剪、
//! 随会话删除级联清理，并与 `agent_message.sessionID`（= threadID）对齐。
//!
//! 不变量：
//! - `body` 是**唯一执行依据**，`steps` 只是给 UI 算进度的摘要；
//! - `status` 是状态机（`draft → running → done / interrupted`），不是展示字段；
//! - `digest` 变化即「计划被改过」：`revision + 1`，`running` 回落 `draft`。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

fn default_steps() -> String {
    "[]".to_string()
}

fn default_status() -> String {
    "draft".to_string()
}

fn default_source() -> String {
    "thread".to_string()
}

fn default_revision() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_plan")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    #[sea_orm(column_name = "sessionID")]
    pub sessionID: String,
    pub title: String,
    pub overview: String,
    /// JSON 数组：仅 UI 进度，**不是**执行依据
    pub steps: String,
    /// 计划正文全量：执行、渲染、保存都用它
    pub body: String,
    /// draft | running | done | interrupted | superseded
    pub status: String,
    /// thread | file
    pub source: String,
    #[sea_orm(column_name = "filePath")]
    pub filePath: Option<String>,
    pub revision: i64,
    pub digest: String,
    /// 正文超长被截断时置位（UI 提示「计划不完整」）
    pub truncated: bool,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
    #[sea_orm(column_name = "executedAt")]
    pub executedAt: Option<i64>,
    #[sea_orm(column_name = "finishedAt")]
    pub finishedAt: Option<i64>,
    /// 上一次**开始执行**时用的是第几版：执行入口写入，改版**不**清它 ——
    /// `revision > executedRevision` 即「计划改过了，上次执行基于旧版」。
    #[sea_orm(column_name = "executedRevision")]
    pub executedRevision: Option<i64>,
    /// 被哪一版取代（`done` / `interrupted` 的旧版在改版时归档）。
    #[sea_orm(column_name = "supersededBy")]
    pub supersededBy: Option<i64>,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    pub sessionID: Option<String>,
    /// 列表查询是否也带正文。默认 false —— `body` 数 KB 级，列表/裁剪不该搬它；
    /// 按 `id` / `sessionID` 精读时服务层默认带正文。
    #[serde(default)]
    pub includeBody: bool,
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
    pub title: String,
    #[serde(default)]
    pub overview: String,
    #[serde(default = "default_steps")]
    pub steps: String,
    #[serde(default)]
    pub body: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub filePath: Option<String>,
    #[serde(default = "default_revision")]
    pub revision: i64,
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub truncated: bool,
    pub createdAt: Option<i64>,
    pub updatedAt: Option<i64>,
    #[serde(default)]
    pub executedAt: Option<i64>,
    #[serde(default)]
    pub finishedAt: Option<i64>,
    /// 上次执行时用的 revision（`None` = 还没执行过）
    #[serde(default)]
    pub executedRevision: Option<i64>,
    /// 被哪一版取代
    #[serde(default)]
    pub supersededBy: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WriteP {
    One(Write),
    Many(Vec<Write>),
}

/// 部分更新：**只列允许改的列**，不在这里的字段调用方改不动。
///
/// 状态位与执行时间戳都走这里（`setPlanStatus` / `bumpRevision` 的实现基础）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub title: Option<String>,
    pub overview: Option<String>,
    pub steps: Option<String>,
    pub body: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub filePath: Option<Option<String>>,
    pub revision: Option<i64>,
    pub digest: Option<String>,
    pub truncated: Option<bool>,
    pub updatedAt: Option<i64>,
    pub executedAt: Option<Option<i64>>,
    pub finishedAt: Option<Option<i64>>,
    pub executedRevision: Option<Option<i64>>,
    pub supersededBy: Option<Option<i64>>,
}

/// `key` 可以是 `id`，也可以是 `sessionID` —— 前端手里常常只有会话 ID。
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
