use sea_orm::entity::prelude::*;

/// 服务端 agent 的审批台账（一行一次「人做了什么决定」）。
///
/// 主键是编排确定性生成的审批标识（`<taskID>:<步骤>:<第几次调用>`），不是代理键：
/// 同一次调用天然只有一行，重复提交靠主键撞上既有行来识别。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "agent_approval")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Text")]
    pub id: String,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    #[sea_orm(column_name = "taskID", indexed)]
    pub task_id: Uuid,
    /// 第几轮提出的
    pub step: i32,
    /// 待执行的工具名
    #[sea_orm(column_type = "Text")]
    pub tool: String,
    /// 模型给的参数原文（不做 JSON 解析：解析失败不该让「人批过什么」落不了库）
    #[sea_orm(column_type = "Text")]
    pub arguments: String,
    /// APPROVED / REJECTED（人的两种决定；EXPIRED 是编排的结局，不落这张表）
    #[sea_orm(column_type = "Text")]
    pub state: String,
    /// 做决定的人
    #[sea_orm(column_name = "decidedBy", nullable)]
    pub decided_by: Option<Uuid>,
    /// 决定时刻
    #[sea_orm(column_name = "decidedAt")]
    pub decided_at: DateTimeWithTimeZone,
    /// 驳回理由
    #[sea_orm(column_type = "Text", nullable)]
    pub reason: Option<String>,
    /// 这一次待办的逾期时间（编排给的）
    #[sea_orm(column_name = "expiresAt")]
    pub expires_at: DateTimeWithTimeZone,
    /// 决定**送进编排邮箱**的时刻；NULL = 已提交但还没送达（重复提交会补投）
    #[sea_orm(column_name = "appliedAt", nullable)]
    pub applied_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
