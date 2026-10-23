use sea_orm::entity::prelude::*;

/// 服务端 agent 的任务台账（一行一次任务）。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_task")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 发起人；服务身份（无会话）触发时为 NULL
    #[sea_orm(column_name = "userID", nullable)]
    pub user_id: Option<Uuid>,
    /// RUNNING / SUCCEEDED / FAILED（词汇定义在 crates/agent）
    #[sea_orm(column_type = "Text")]
    pub status: String,
    /// 任务目标
    #[sea_orm(column_type = "Text")]
    pub objective: String,
    /// 实际使用的模型名
    #[sea_orm(column_type = "Text")]
    pub model: String,
    /// 轮次上限
    #[sea_orm(column_name = "maxSteps")]
    pub max_steps: i32,
    /// 工具白名单；空数组 = 不给工具
    #[sea_orm(column_name = "allowedTools", column_type = "JsonBinary")]
    pub allowed_tools: Json,
    /// 编排实例标识（`agent-{id}`）
    #[sea_orm(column_name = "instanceID", column_type = "Text")]
    pub instance_id: String,
    /// 已完成轮次
    pub steps: i32,
    /// 终态输出快照
    #[sea_orm(column_type = "JsonBinary", nullable)]
    pub result: Option<Json>,
    /// 终态失败原因
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
