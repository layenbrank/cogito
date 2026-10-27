#![allow(non_snake_case)]

//! 定时任务的定义。**执行**由 `crates/core/src/automation` 与客户端 worker 负责，
//! 本表只存「什么时候跑、跑什么、以谁的身份跑」。
//!
//! `owner` 决定谁来跑：`client` = 本机 worker；`goose` = 交给 goose 的 schedules；
//! `cloud` = 服务端定时任务。一个任务只有一个 owner，避免两处同时触发。
use sea_orm::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "automation")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: String,
    pub name: String,
    /// 交给智能体的一句话（到期时按它起一次会话）
    pub prompt: String,
    /// 关联知识库；为空表示与具体库无关
    #[sea_orm(column_name = "knowledgeBaseId")]
    pub knowledgeBaseId: Option<String>,
    /// cron 表达式（`0 9 * * *`），按 `timezone` 解释
    pub schedule: String,
    pub timezone: String,
    pub enabled: bool,
    /// client | goose | cloud
    pub owner: String,
    /// user | tenant
    #[sea_orm(column_name = "runAsKind")]
    pub runAsKind: String,
    #[sea_orm(column_name = "runAsUserId")]
    pub runAsUserId: Option<String>,
    #[sea_orm(column_name = "tenantId")]
    pub tenantId: Option<String>,
    /// owner=cloud/goose 时对应的远端任务 id；本地只镜像状态
    #[sea_orm(column_name = "remoteId")]
    pub remoteId: Option<String>,
    /// 下次应触发的时间（epoch ms）；为空 = 已停用或尚未排期
    #[sea_orm(column_name = "nextRunAt")]
    pub nextRunAt: Option<i64>,
    #[sea_orm(column_name = "lastRunAt")]
    pub lastRunAt: Option<i64>,
    /// succeeded | failed | running
    #[sea_orm(column_name = "lastStatus")]
    pub lastStatus: Option<String>,
    #[sea_orm(column_name = "lastError")]
    pub lastError: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub createdAt: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updatedAt: i64,
}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::automation_run::Entity")]
    Runs,
}

impl Related<super::automation_run::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Runs.def()
    }
}
