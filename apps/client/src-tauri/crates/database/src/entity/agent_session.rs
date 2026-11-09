#![allow(non_snake_case)]

use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_session")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub title: String,
    pub pinned: bool,
    #[sea_orm(column_name = "providerID")]
    pub providerID: Option<String>,
    #[sea_orm(column_name = "workspaceID")]
    pub workspaceID: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
    /// 有未读回复：`false` = 已读（默认），`true` = 这一轮跑完但用户还没打开过。
    ///
    /// 放列里而不是前端内存：切会话、重启之后未读也不该丢 —— 这正是它跟
    /// `run-state.ts` 那个「跑完待领取」集合的区别（后者只是本次进程内的运行态）。
    #[sea_orm(column_name = "unread")]
    pub unread: bool,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub id: Option<String>,
    pub workspaceID: Option<String>,
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
    pub title: String,
    #[serde(default)]
    pub pinned: bool,
    pub providerID: Option<String>,
    pub workspaceID: Option<String>,
    pub createdAt: Option<i64>,
    pub updatedAt: Option<i64>,
    /// 新会话默认已读（`#[serde(default)]`）：用户点开它才会有第一条消息。
    #[serde(default)]
    pub unread: bool,
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
    pub title: Option<String>,
    pub pinned: Option<bool>,
    pub providerID: Option<Option<String>>,
    pub workspaceID: Option<Option<String>>,
    /// 已读 / 未读（唯一一个**不**推进 `updatedAt` 的可改字段，见 `update_one`）
    pub unread: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
