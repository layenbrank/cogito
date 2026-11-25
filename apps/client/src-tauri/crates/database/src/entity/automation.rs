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
    #[sea_orm(column_name = "knowledgeSpaceID")]
    pub knowledge_space_id: Option<String>,
    /// 执行时的工作区（`agent_workspace` 的 id）；为空 = 家目录
    #[sea_orm(column_name = "workspaceID")]
    pub workspace_id: Option<String>,
    /// 工作区下**具体哪个目录**（文件夹绝对路径）；为空 = 跟随工作区默认（第一个可用目录）
    #[sea_orm(column_name = "workspacePath")]
    pub workspace_path: Option<String>,
    /// 会话绑定：new（每次新建）/ fixed（固定写进 `sessionID`）/ ask（执行前选）
    ///
    /// 「新建会话」是缺省：任务本来自带一次性的执行记录；绑定会话是为了让结果落进
    /// 用户自己那场对话里（回看上下文、继续追问）。
    #[sea_orm(column_name = "sessionMode")]
    pub session_mode: String,
    /// 绑定到的会话 id（`agent_session.id`）；`session_mode = fixed` 时必填
    #[sea_orm(column_name = "sessionID")]
    pub session_id: Option<String>,
    /// 执行授权档：readonly | auto（无人值守，不出现 ask）
    pub approval: String,
    /// 固定供应商（本地 provider 行 id）；空 = 跟随当前激活
    #[sea_orm(column_name = "providerID")]
    pub provider_id: Option<String>,
    /// 固定模型 id；空 = 跟随当前激活
    #[sea_orm(column_name = "modelID")]
    pub model_id: Option<String>,
    /// 单模式：agent | plan | goal；`plan_then_goal` 开启时执行侧走流水线
    pub mode: String,
    /// 目标模式 / 流水线第二段的最大轮次（含首轮）
    #[sea_orm(column_name = "goalBudget")]
    pub goal_budget: i32,
    /// 1 = 先 plan 再 goal；0 = 按 `mode` 单模式跑
    #[sea_orm(column_name = "planThenGoal")]
    pub plan_then_goal: bool,
    /// 绑定的工作区计划文件（相对路径，如 `.cogito/plans/foo.md`）；空 = 不绑定
    #[sea_orm(column_name = "planFilePath")]
    pub plan_file_path: Option<String>,
    /// 执行时的思考强度：off | low | medium（缺省「标准」）| high | max
    ///
    /// 与 goose 全局键 `GOOSE_THINKING_EFFORT` 同枚举；只作用于本任务起的会话，
    /// 不改用户在 composer / 右栏里给同一模型选的档位。
    pub thinking: String,
    /// cron 表达式（`0 9 * * *`），按 `timezone` 解释
    pub schedule: String,
    pub timezone: String,
    pub enabled: bool,
    /// 字典 automation_owner：001 本机 / 002 goose / 003 云端
    pub owner: String,
    /// user | tenant
    #[sea_orm(column_name = "runAsKind")]
    pub run_as_kind: String,
    #[sea_orm(column_name = "runAsUserID")]
    pub run_as_user_id: Option<String>,
    #[sea_orm(column_name = "tenantID")]
    pub tenant_id: Option<String>,
    /// owner=cloud/goose 时对应的远端任务 id；本地只镜像状态
    #[sea_orm(column_name = "remoteID")]
    pub remote_id: Option<String>,
    /// 下次应触发的时间（epoch ms）；为空 = 已停用或尚未排期
    #[sea_orm(column_name = "nextRunAt")]
    pub next_run_at: Option<i64>,
    #[sea_orm(column_name = "lastRunAt")]
    pub last_run_at: Option<i64>,
    /// succeeded | failed | running
    #[sea_orm(column_name = "lastStatus")]
    pub last_status: Option<String>,
    #[sea_orm(column_name = "lastError")]
    pub last_error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: i64,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: i64,
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
