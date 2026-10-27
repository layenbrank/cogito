use sea_orm::entity::prelude::*;

/// 服务端定时任务（`owner=cloud` 的那一路）。
///
/// 与客户端 `automation` 表同名不同库：客户端那份给「应用运行时执行」，这份给
/// 「关掉客户端也照跑」。两边都只有一张表，靠 `runAsKind` 决定以谁的身份执行：
/// `user` = 创建者本人（执行时校验仍是租户成员），`tenant` = 租户服务身份。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "scheduled_job")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 创建人（审计用；`runAsKind=user` 时也是执行身份）
    #[sea_orm(column_name = "creator")]
    pub creator: Uuid,
    pub name: String,
    /// 交给智能体的一句话（起一次 agent 任务的目标）
    pub prompt: String,
    /// 5 段 crontab（分 时 日 月 周），按 `timezone` 解释
    pub cron: String,
    pub timezone: String,
    pub enabled: bool,
    /// user | tenant
    #[sea_orm(column_name = "runAsKind", column_type = "Text")]
    pub run_as_kind: String,
    /// `runAsKind=user` 时的执行身份；为空表示用创建人
    #[sea_orm(column_name = "runAsUserID", nullable)]
    pub run_as_user_id: Option<Uuid>,
    /// 下次触发（epoch ms）；停用或已跑完待重排时为 NULL
    #[sea_orm(column_name = "nextRunAt", nullable)]
    pub next_run_at: Option<i64>,
    #[sea_orm(column_name = "lastRunAt", nullable)]
    pub last_run_at: Option<i64>,
    /// running | succeeded | failed
    #[sea_orm(column_name = "lastStatus", column_type = "Text", nullable)]
    pub last_status: Option<String>,
    #[sea_orm(column_name = "lastError", column_type = "Text", nullable)]
    pub last_error: Option<String>,
    /// 最近一次起出来的 agent 任务 id（点进任务详情用）
    #[sea_orm(column_name = "lastTaskID", nullable)]
    pub last_task_id: Option<Uuid>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
}

impl ActiveModelBehavior for ActiveModel {}
