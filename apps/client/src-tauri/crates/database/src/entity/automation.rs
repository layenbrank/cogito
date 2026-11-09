#![allow(non_snake_case)]

//! 定时任务的定义。**执行**由 `crates/core/src/automation` 与客户端 worker 负责，
//! 本表存「什么时候跑、跑什么、以谁的身份跑、在哪个目录跑、授权、模型与模式」。
//!
//! `owner` 为字典 automation_owner（021 本机 / 022 goose / 023 云端）。
//! 一个任务只有一个 owner，避免两处同时触发。
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
    /// 执行时的工作区（`agent_workspace` 的 id）；为空 = 家目录
    #[sea_orm(column_name = "workspaceId")]
    pub workspaceId: Option<String>,
    /// 工作区下**具体哪个目录**（文件夹绝对路径）；为空 = 跟随工作区默认（第一个可用目录）
    #[sea_orm(column_name = "workspacePath")]
    pub workspacePath: Option<String>,
    /// 会话绑定：new（每次新建）/ fixed（固定写进 sessionId）/ ask（执行前选）
    ///
    /// 「新建会话」是缺省：任务本来自带一次性的执行记录；绑定会话是为了让结果落进
    /// 用户自己那场对话里（回看上下文、继续追问）。
    #[sea_orm(column_name = "sessionMode")]
    pub sessionMode: String,
    /// 绑定到的会话 id（`agent_session.id`）；`sessionMode = fixed` 时必填
    #[sea_orm(column_name = "sessionId")]
    pub sessionId: Option<String>,
    /// 执行授权档：readonly | auto（无人值守，不出现 ask）
    pub approval: String,
    /// 固定供应商（本地 provider 行 id）；空 = 跟随当前激活
    #[sea_orm(column_name = "providerId")]
    pub providerId: Option<String>,
    /// 固定模型 id；空 = 跟随当前激活
    #[sea_orm(column_name = "modelId")]
    pub modelId: Option<String>,
    /// 单模式：agent | plan | goal；`planThenGoal` 开启时执行侧走流水线
    pub mode: String,
    /// 目标模式 / 流水线第二段的最大轮次（含首轮）
    #[sea_orm(column_name = "goalBudget")]
    pub goalBudget: i32,
    /// 1 = 先 plan 再 goal；0 = 按 `mode` 单模式跑
    #[sea_orm(column_name = "planThenGoal")]
    pub planThenGoal: bool,
    /// 绑定的工作区计划文件（相对路径，如 `.cogito/plans/foo.md`）；空 = 不绑定
    #[sea_orm(column_name = "planFilePath")]
    pub planFilePath: Option<String>,
    /// cron 表达式（`0 9 * * *`），按 `timezone` 解释
    pub schedule: String,
    pub timezone: String,
    pub enabled: bool,
    /// 字典 automation_owner：001 本机 / 002 goose / 003 云端
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
