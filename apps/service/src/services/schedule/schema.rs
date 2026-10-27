//! 定时任务的请求 / 响应形状。
//!
//! 与客户端 `automation` 的差别：**排期由服务端算**，客户端不传 `nextRunAt`；
//! `cron` 用 5 段 crontab，按 `timezone` 解释。

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 新建（`id` 为空）或整体替换（`id` 非空）一个任务
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobP {
    pub id: Option<String>,
    pub name: String,
    /// 起一次 agent 任务的目标
    pub prompt: String,
    /// 5 段 crontab（分 时 日 月 周）
    pub cron: String,
    /// IANA 时区，缺省 `Asia/Shanghai`
    pub timezone: Option<String>,
    /// user | tenant，缺省 user
    pub run_as_kind: Option<String>,
    /// `runAsKind=user` 时的执行身份，缺省用创建人
    pub run_as_user_id: Option<String>,
    pub enabled: Option<bool>,
}

/// 局部更新：只改传入的项
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobPatchP {
    pub name: Option<String>,
    pub prompt: Option<String>,
    pub cron: Option<String>,
    pub timezone: Option<String>,
    pub run_as_kind: Option<String>,
    pub run_as_user_id: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JobR {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub cron: String,
    pub timezone: String,
    pub enabled: bool,
    pub run_as_kind: String,
    pub run_as_user_id: Option<String>,
    /// 下次触发（epoch ms）；停用或非本机排期的任务为空
    pub next_run_at: Option<i64>,
    pub last_run_at: Option<i64>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    /// 最近一次起出来的 agent 任务 id
    pub last_task_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl JobR {
    #[must_use]
    pub fn of(row: &entity::scheduled_job::Model) -> Self {
        Self {
            id: row.id.to_string(),
            name: row.name.clone(),
            prompt: row.prompt.clone(),
            cron: row.cron.clone(),
            timezone: row.timezone.clone(),
            enabled: row.enabled,
            run_as_kind: row.run_as_kind.clone(),
            run_as_user_id: row.run_as_user_id.map(|value| value.to_string()),
            next_run_at: row.next_run_at,
            last_run_at: row.last_run_at,
            last_status: row.last_status.clone(),
            last_error: row.last_error.clone(),
            last_task_id: row.last_task_id.map(|value| value.to_string()),
            created_at: row.created_at.timestamp_millis(),
            updated_at: row.updated_at.timestamp_millis(),
        }
    }
}
