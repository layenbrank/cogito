#![allow(non_snake_case)]

//! 定时任务的读写与排期。
//!
//! 三条不变量：
//! 1. **保存即校验**：cron / 时区写错在保存时就报 `Validation`，不等 worker tick 才发现；
//! 2. **只补一次**：`nextRunAt` 推进到「下一个未来的时间点」，错过多轮也只执行一次；
//! 3. **一次触发一条记录**：`(automationId, scheduledFor)` 唯一，重复 tick / 动手执行都不会重跑。

use chrono::{DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use cogito_database::entity::{automation as schema, automation_run as run_schema};
use cron::Schedule;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

use crate::dict::{
    automation_owner, automation_run_as, automation_run_status, automation_trigger_kind,
};
use crate::exception::Exception;

/// 默认时区。落库跟随任务而不是跟随系统：用户改系统时区不该让别人的班表漂移。
pub const DEFAULT_TIMEZONE: &str = "Asia/Shanghai";

/// 迟到多少毫秒以内仍算准点（超过记为 `catchup` 补跑）
const CATCHUP_GRACE_MS: i64 = 120_000;

/// 一次 tick 最多认领多少个任务：前端是串行队列，一次领一堆只会让后来的记录在排队中变「陈旧」
const CLAIM_LIMIT: u64 = 1;

/// 执行授权档：只读（默认）/ 自动批准。
///
/// **没有 `ask`**：任务无人值守，等一个不存在的点击只会卡到票据超时。
/// 与客户端 `ApprovalMode` 的 `readonly` / `auto` 是同一套取值。
pub const APPROVAL_READONLY: &str = "readonly";
pub const APPROVAL_AUTO: &str = "auto";

/// 单模式：agent / plan / goal（与客户端 `AgentMode` 对齐；任务里没有 ask）
pub const MODE_AGENT: &str = "agent";
pub const MODE_PLAN: &str = "plan";
pub const MODE_GOAL: &str = "goal";

/// 目标轮次允许档（与客户端 `GOAL_BUDGET_OPTIONS` 对齐）
const GOAL_BUDGET_OPTIONS: [i32; 3] = [3, 6, 12];
const DEFAULT_GOAL_BUDGET: i32 = 6;

/// 回写输出/错误的截断长度
const OUTPUT_LIMIT: usize = 4_000;
const ERROR_LIMIT: usize = 1_000;

/// 新建或修改任务
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationInput {
    /// 有值则修改该任务，否则新建
    pub id: Option<String>,
    pub name: String,
    /// 到期时交给智能体的一句话
    pub prompt: String,
    pub knowledgeBaseId: Option<String>,
    /// 执行时的工作目录（`agent_workspace` 的 id）；为空 = 家目录
    pub workspaceId: Option<String>,
    /// 执行授权档：readonly | auto；缺省 readonly（无人值守没有 ask）
    pub approval: Option<String>,
    /// 固定供应商；空 = 跟随当前激活
    pub providerId: Option<String>,
    /// 固定模型；空 = 跟随当前激活
    pub modelId: Option<String>,
    /// agent | plan | goal；缺省 agent
    pub mode: Option<String>,
    /// 目标轮次；缺省 6
    pub goalBudget: Option<i32>,
    /// 先 plan 再 goal；缺省 false
    pub planThenGoal: Option<bool>,
    /// 绑定的工作区计划文件（相对路径）；空 = 不绑定
    pub planFilePath: Option<String>,
    /// 5 段 crontab（分 时 日 月 周）；带秒的 6–7 段也接受
    pub schedule: String,
    pub timezone: Option<String>,
    pub enabled: Option<bool>,
    /// client | goose | cloud；缺省 client
    pub owner: Option<String>,
    /// user | tenant；缺省 user
    pub runAsKind: Option<String>,
    pub runAsUserId: Option<String>,
    pub tenantId: Option<String>,
}

/// 回写一次执行结果；`error` 非空即视为失败
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishInput {
    pub runId: String,
    pub output: Option<String>,
    pub error: Option<String>,
}

/// 执行过程中补写会话回链与阶段（前端开会话 / 切流水线阶段时调用）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchRunInput {
    pub runId: String,
    pub sessionId: Option<String>,
    pub phase: Option<String>,
}

/// 到期/手动触发后交回调用方的东西：任务定义 + 本次执行记录
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DueRun {
    pub automation: schema::Model,
    pub run: run_schema::Model,
}

pub struct Service;

impl Service {
    /// 下一个触发时间（epoch ms，严格晚于 `after_ms`），按 `timezone` 解释表达式。
    pub fn toNext(schedule: &str, timezone: &str, after_ms: i64) -> Result<i64, Exception> {
        let zone: Tz = timezone
            .trim()
            .parse()
            .map_err(|_| Exception::Validation(format!("时区不合法：{timezone}")))?;
        let local = Utc
            .timestamp_millis_opt(after_ms)
            .single()
            .ok_or_else(|| Exception::Validation("时间戳不合法".to_string()))?
            .with_timezone(&zone);
        // `L`（当月最后一天）不是标准 crontab，`cron` crate 也不认：自己算；
        // 其它形状仍交给它，两套语义不会互相污染。
        if let Some(next) = next_last_day(schedule, &zone, &local)? {
            return Ok(next);
        }
        let parsed = Schedule::from_str(&expand(schedule)?)
            .map_err(|error| Exception::Validation(format!("定时表达式不合法：{error}")))?;
        let next = parsed
            .after(&local)
            .next()
            .ok_or_else(|| Exception::Validation("这个表达式不会再触发".to_string()))?;
        Ok(next.timestamp_millis())
    }

    pub async fn toSave<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: AutomationInput,
    ) -> Result<schema::Model, Exception> {
        let name = input.name.trim().to_string();
        if name.is_empty() {
            return Err(Exception::Validation("任务名称不能为空".to_string()));
        }
        let plan_file_path = input
            .planFilePath
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let prompt = input.prompt.trim().to_string();
        // 绑定了计划文件时，执行依据是计划正文，附加说明可空
        if prompt.is_empty() && plan_file_path.is_none() {
            return Err(Exception::Validation("任务内容不能为空".to_string()));
        }
        let schedule = input.schedule.trim().to_string();
        let timezone = input
            .timezone
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_TIMEZONE.to_string());
        let enabled = input.enabled.unwrap_or(true);
        let workspace_id = input
            .workspaceId
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let approval = input
            .approval
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| APPROVAL_READONLY.to_string());
        if !matches!(approval.as_str(), APPROVAL_READONLY | APPROVAL_AUTO) {
            return Err(Exception::Validation(format!(
                "不支持的执行授权：{approval}（只有只读 / 自动批准）"
            )));
        }
        // 自动批准 = 无人值守的写权限：没有工作目录就只能锁在只读，绝不默认放开整个磁盘
        if approval == APPROVAL_AUTO && workspace_id.is_none() {
            return Err(Exception::Validation(
                "自动批准必须先指定工作目录（把写入范围限制在这个目录内）".to_string(),
            ));
        }
        let owner = input.owner.unwrap_or_else(|| automation_owner::CLIENT.to_string());
        if !matches!(owner.as_str(), automation_owner::CLIENT | automation_owner::GOOSE | automation_owner::CLOUD) {
            return Err(Exception::Validation(format!("不支持的执行方：{owner}")));
        }
        let run_as_kind = input.runAsKind.unwrap_or_else(|| automation_run_as::USER.to_string());
        if !matches!(run_as_kind.as_str(), automation_run_as::USER | automation_run_as::TENANT) {
            return Err(Exception::Validation(format!("不支持的执行身份：{run_as_kind}")));
        }
        let mode = input
            .mode
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| MODE_AGENT.to_string());
        if !matches!(mode.as_str(), MODE_AGENT | MODE_PLAN | MODE_GOAL) {
            return Err(Exception::Validation(format!(
                "不支持的执行模式：{mode}（只有执行 / 计划 / 目标）"
            )));
        }
        let goal_budget = input.goalBudget.unwrap_or(DEFAULT_GOAL_BUDGET);
        if !GOAL_BUDGET_OPTIONS.contains(&goal_budget) {
            return Err(Exception::Validation(format!(
                "不支持的目标轮次：{goal_budget}（只有 3 / 6 / 12）"
            )));
        }
        let mut plan_then_goal = input.planThenGoal.unwrap_or(false);
        let provider_id = input
            .providerId
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let model_id = input
            .modelId
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        // 固定模型必须成对：只写一边会让执行侧猜另一半，不如保存时就拦住
        if provider_id.is_some() != model_id.is_some() {
            return Err(Exception::Validation(
                "固定模型需要同时指定供应商与模型，或都留空跟随当前".to_string(),
            ));
        }
        if plan_file_path.is_some() {
            if workspace_id.is_none() {
                return Err(Exception::Validation(
                    "绑定计划文件必须先指定工作目录".to_string(),
                ));
            }
            if mode == MODE_PLAN {
                return Err(Exception::Validation(
                    "已绑定计划时不能再选「计划」模式（请用执行或目标去落地）".to_string(),
                ));
            }
            // 绑定计划与「计划后执行」互斥：执行依据已是现成计划
            plan_then_goal = false;
        }

        let now = Utc::now().timestamp_millis();
        // 只有本机 worker 需要 nextRunAt；其它 owner 由远端排期，这里留空
        let next_run = if enabled && owner == automation_owner::CLIENT {
            Some(Self::toNext(&schedule, &timezone, now)?)
        } else {
            None
        };

        if let Some(id) = input.id.clone() {
            let existing = schema::Entity::find_by_id(id.clone())
                .one(db)
                .await?
                .ok_or_else(|| Exception::NotFound(format!("任务不存在：{id}")))?;
            let mut active: schema::ActiveModel = existing.into();
            active.name = Set(name);
            active.prompt = Set(prompt);
            active.knowledgeBaseId = Set(input.knowledgeBaseId);
            active.workspaceId = Set(workspace_id);
            active.approval = Set(approval);
            active.providerId = Set(provider_id);
            active.modelId = Set(model_id);
            active.mode = Set(mode);
            active.goalBudget = Set(goal_budget);
            active.planThenGoal = Set(plan_then_goal);
            active.planFilePath = Set(plan_file_path);
            active.schedule = Set(schedule);
            active.timezone = Set(timezone);
            active.enabled = Set(enabled);
            active.owner = Set(owner);
            active.runAsKind = Set(run_as_kind);
            active.runAsUserId = Set(input.runAsUserId);
            active.tenantId = Set(input.tenantId);
            active.nextRunAt = Set(next_run);
            active.updatedAt = Set(now);
            return Ok(active.update(db).await?);
        }

        let model = schema::Model {
            id: Uuid::new_v4().to_string(),
            name,
            prompt,
            knowledgeBaseId: input.knowledgeBaseId,
            workspaceId: workspace_id,
            approval,
            providerId: provider_id,
            modelId: model_id,
            mode,
            goalBudget: goal_budget,
            planThenGoal: plan_then_goal,
            planFilePath: plan_file_path,
            schedule,
            timezone,
            enabled,
            owner,
            runAsKind: run_as_kind,
            runAsUserId: input.runAsUserId,
            tenantId: input.tenantId,
            remoteId: None,
            nextRunAt: next_run,
            lastRunAt: None,
            lastStatus: None,
            lastError: None,
            createdAt: now,
            updatedAt: now,
        };
        // TEXT 主键 + SQLite 下 `insert()` 会再发一次 SELECT，取不到就报错，故用 exec
        schema::Entity::insert(schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;
        Ok(model)
    }

    pub async fn toList<C: ConnectionTrait + TransactionTrait>(
        db: &C,
    ) -> Result<Vec<schema::Model>, Exception> {
        Ok(schema::Entity::find()
            .order_by_asc(schema::Column::CreatedAt)
            .all(db)
            .await?)
    }

    /// 按 id 取单个任务：命令层别再 `toList().find` 扫全表
    pub async fn toGet<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<Option<schema::Model>, Exception> {
        Ok(schema::Entity::find_by_id(id).one(db).await?)
    }

    pub async fn toSetEnabled<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
        enabled: bool,
    ) -> Result<schema::Model, Exception> {
        let existing = schema::Entity::find_by_id(id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("任务不存在：{id}")))?;
        let now = Utc::now().timestamp_millis();
        // 重新启用要从「现在」重排，否则会把停用期间错过的时间点补跑一遍
        let next_run = if enabled && existing.owner == automation_owner::CLIENT {
            Some(Self::toNext(&existing.schedule, &existing.timezone, now)?)
        } else {
            None
        };
        let mut active: schema::ActiveModel = existing.into();
        active.enabled = Set(enabled);
        active.nextRunAt = Set(next_run);
        active.updatedAt = Set(now);
        Ok(active.update(db).await?)
    }

    pub async fn toRemove<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<u64, Exception> {
        // 执行记录靠外键 ON DELETE CASCADE 一起清掉
        let result = schema::Entity::delete_by_id(id).exec(db).await?;
        Ok(result.rows_affected)
    }

    /// 记下「远端（goose）那边同步到了哪一步」。
    ///
    /// `owner=goose` 的排期在 goose 手里，本地这份只是镜像；同步失败把原因写进
    /// `lastError`，用户能在列表里直接看到，而不是只有日志。
    pub async fn toSetRemote<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
        remote_id: Option<String>,
        last_error: Option<String>,
    ) -> Result<schema::Model, Exception> {
        let existing = schema::Entity::find_by_id(id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("任务不存在：{id}")))?;
        let status = if last_error.is_some() { automation_run_status::FAILED } else { "" };
        let mut active: schema::ActiveModel = existing.into();
        active.remoteId = Set(remote_id);
        active.lastError = Set(last_error);
        active.lastStatus = Set(Some(status.to_string()).filter(|value| !value.is_empty()));
        active.updatedAt = Set(Utc::now().timestamp_millis());
        Ok(active.update(db).await?)
    }

    /// 认领到期任务（owner=client）。返回空表示这一轮没事可做。
    pub async fn toClaimDue<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        now_ms: i64,
    ) -> Result<Vec<DueRun>, Exception> {
        let due = schema::Entity::find()
            .filter(schema::Column::Enabled.eq(true))
            .filter(schema::Column::Owner.eq(automation_owner::CLIENT))
            .filter(schema::Column::NextRunAt.lte(now_ms))
            .order_by_asc(schema::Column::NextRunAt)
            .limit(CLAIM_LIMIT)
            .all(db)
            .await?;
        if due.is_empty() {
            return Ok(Vec::new());
        }

        let tx = db.begin().await?;
        let mut claimed = Vec::new();
        for item in due {
            let scheduled_for = item.nextRunAt.unwrap_or(now_ms);
            // 表达式在保存时校验过；仍算不出来就停用，不让它每 12 秒刷一次错
            let next = match Self::toNext(&item.schedule, &item.timezone, now_ms.max(scheduled_for))
            {
                Ok(next) => next,
                Err(error) => {
                    let mut broken: schema::ActiveModel = item.into();
                    broken.enabled = Set(false);
                    broken.nextRunAt = Set(None);
                    broken.lastStatus = Set(Some(automation_run_status::FAILED.to_string()));
                    broken.lastError = Set(Some(error.to_string()));
                    broken.updatedAt = Set(now_ms);
                    broken.update(&tx).await?;
                    continue;
                }
            };
            let mut active: schema::ActiveModel = item.clone().into();
            active.nextRunAt = Set(Some(next));
            active.updatedAt = Set(now_ms);
            let automation = active.update(&tx).await?;

            let trigger = if now_ms - scheduled_for > CATCHUP_GRACE_MS {
                automation_trigger_kind::CATCHUP
            } else {
                automation_trigger_kind::SCHEDULE
            };
            if let Some(run) =
                Self::insert_run(&tx, &automation, scheduled_for, trigger, now_ms).await?
            {
                claimed.push(DueRun { automation, run });
            }
        }
        tx.commit().await?;
        Ok(claimed)
    }

    /// 手动执行一次（不看 enabled，也不改 nextRunAt）
    pub async fn toRunNow<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        id: String,
    ) -> Result<DueRun, Exception> {
        let automation = schema::Entity::find_by_id(id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("任务不存在：{id}")))?;
        let now = Utc::now().timestamp_millis();
        let run = Self::insert_run(db, &automation, now, automation_trigger_kind::MANUAL, now)
            .await?
            .ok_or_else(|| Exception::Validation("这一毫秒已经触发过一次，请稍后重试".to_string()))?;
        Ok(DueRun { automation, run })
    }

    /// 回写执行结果（前端跑完/失败后调用）
    pub async fn toFinish<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: FinishInput,
    ) -> Result<run_schema::Model, Exception> {
        let existing = run_schema::Entity::find_by_id(input.runId.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("执行记录不存在：{}", input.runId)))?;
        // 已经被回收（30 分钟没回写）的记录不再改写：成功与失败互相覆盖会让记录和真实结果都不可信
        if existing.status != automation_run_status::RUNNING {
            return Ok(existing);
        }

        let failed = input
            .error
            .as_deref()
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);
        let status = if failed { automation_run_status::FAILED } else { automation_run_status::SUCCEEDED };
        let now = Utc::now().timestamp_millis();

        let mut active: run_schema::ActiveModel = existing.clone().into();
        active.status = Set(status.to_string());
        active.output = Set(input.output.map(|value| truncate(&value, OUTPUT_LIMIT)));
        active.error = Set(input.error.map(|value| truncate(&value, ERROR_LIMIT)));
        active.finishedAt = Set(Some(now));
        let run = active.update(db).await?;

        if let Some(automation) = schema::Entity::find_by_id(existing.automationId.clone())
            .one(db)
            .await?
        {
            let mut active: schema::ActiveModel = automation.into();
            active.lastStatus = Set(Some(status.to_string()));
            active.lastError = Set(run.error.clone());
            active.lastRunAt = Set(run.startedAt.or(Some(now)));
            active.updatedAt = Set(now);
            active.update(db).await?;
        }
        Ok(run)
    }

    /// 真正开跑时把 `startedAt` 补成现在。
    ///
    /// claim 写的是「排队开始」的时间：串行队列里后来者会把排队时间算进耗时，
    /// 排队超过 30 分钟还会被 `toReapStale` 当成「没回写」直接判失败。前端开跑前调一次。
    pub async fn toTouchRun<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        run_id: String,
    ) -> Result<run_schema::Model, Exception> {
        let existing = run_schema::Entity::find_by_id(run_id.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("执行记录不存在：{run_id}")))?;
        if existing.status != automation_run_status::RUNNING {
            return Err(Exception::Validation("这条执行记录已经结束，不能再开跑".to_string()));
        }
        let mut active: run_schema::ActiveModel = existing.into();
        active.startedAt = Set(Some(Utc::now().timestamp_millis()));
        Ok(active.update(db).await?)
    }

    /// 补写会话回链 / 阶段：开会话后写 `sessionId`，流水线切阶段写 `phase`。
    ///
    /// 已结束的记录仍允许补 `sessionId`（finish 与开会话可能并发），但 `phase` 只在仍 running 时改。
    pub async fn toPatchRun<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        input: PatchRunInput,
    ) -> Result<run_schema::Model, Exception> {
        let existing = run_schema::Entity::find_by_id(input.runId.clone())
            .one(db)
            .await?
            .ok_or_else(|| Exception::NotFound(format!("执行记录不存在：{}", input.runId)))?;
        let mut active: run_schema::ActiveModel = existing.clone().into();
        if let Some(session_id) = input.sessionId {
            let trimmed = session_id.trim().to_string();
            if !trimmed.is_empty() {
                active.sessionId = Set(Some(trimmed));
            }
        }
        if let Some(phase) = input.phase {
            let trimmed = phase.trim().to_string();
            if !matches!(trimmed.as_str(), MODE_AGENT | MODE_PLAN | MODE_GOAL) {
                return Err(Exception::Validation(format!(
                    "不支持的执行阶段：{trimmed}"
                )));
            }
            if existing.status != automation_run_status::RUNNING {
                return Err(Exception::Validation(
                    "这条执行记录已经结束，不能再改阶段".to_string(),
                ));
            }
            active.phase = Set(Some(trimmed));
        }
        Ok(active.update(db).await?)
    }

    /// 收尸：running 记录超过阈值还没回写就标失败。两条分支缺一不可：
    ///
    /// 1. `startedAt < 截止点` —— 开跑了但没回写（会话中断、应用被杀）；
    /// 2. `startedAt IS NULL AND scheduledFor < 截止点` —— **认领了却从来没开跑**。
    ///    事件丢在 WebView 重载 / 监听未就绪的那一瞬，认领时不再写 startedAt，
    ///    而 SQL 里 `NULL < 截止点` 不成立 —— 只写分支 1 的话这条记录会永远停在
    ///    「执行中」，用户看到的就是「任务没跑，记录还一直转圈」。
    pub async fn toReapStale<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        now_ms: i64,
        stale_ms: i64,
    ) -> Result<u64, Exception> {
        let cutoff = now_ms - stale_ms;
        let stale = run_schema::Entity::find()
            .filter(run_schema::Column::Status.eq(automation_run_status::RUNNING))
            .filter(
                sea_orm::Condition::any()
                    .add(run_schema::Column::StartedAt.lt(cutoff))
                    .add(
                        sea_orm::Condition::all()
                            .add(run_schema::Column::StartedAt.is_null())
                            .add(run_schema::Column::ScheduledFor.lt(cutoff)),
                    ),
            )
            .all(db)
            .await?;
        let mut reaped = 0;
        for run in stale {
            let mut active: run_schema::ActiveModel = run.clone().into();
            active.status = Set(automation_run_status::FAILED.to_string());
            active.error = Set(Some(if run.startedAt.is_none() {
                "任务没有被执行（应用没在跑或页面正在重载），已标记失败".to_string()
            } else {
                "执行没有回写结果（应用退出或会话中断）".to_string()
            }));
            active.finishedAt = Set(Some(now_ms));
            active.update(db).await?;
            if let Some(automation) = schema::Entity::find_by_id(run.automationId.clone())
                .one(db)
                .await?
            {
                let mut active: schema::ActiveModel = automation.into();
                active.lastStatus = Set(Some(automation_run_status::FAILED.to_string()));
                active.lastError =
                    Set(Some("执行没有回写结果（应用退出或会话中断）".to_string()));
                active.updatedAt = Set(now_ms);
                active.update(db).await?;
            }
            reaped += 1;
        }
        Ok(reaped)
    }

    pub async fn toListRuns<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        automation_id: Option<String>,
        limit: Option<u64>,
    ) -> Result<Vec<run_schema::Model>, Exception> {
        let mut query = run_schema::Entity::find();
        // 任务详情传 Some(任务 id)，页面级「全部记录」传 None 拿最近 N 条（跨任务）
        if let Some(id) = automation_id {
            query = query.filter(run_schema::Column::AutomationId.eq(id));
        }
        Ok(query
            // 按任务过滤（若指定）已在上面完成，这里只定序与限量
            .order_by_desc(run_schema::Column::ScheduledFor)
            .limit(limit.unwrap_or(20).clamp(1, 200))
            .all(db)
            .await?)
    }

    /// 落一条执行记录并把任务上的「上一次」改成 running；同一 (任务, 计划时间) 只落一条
    async fn insert_run<C: ConnectionTrait>(
        db: &C,
        automation: &schema::Model,
        scheduled_for: i64,
        trigger: &str,
        now_ms: i64,
    ) -> Result<Option<run_schema::Model>, Exception> {
        let existing = run_schema::Entity::find()
            .filter(run_schema::Column::AutomationId.eq(automation.id.clone()))
            .filter(run_schema::Column::ScheduledFor.eq(scheduled_for))
            .one(db)
            .await?;
        if existing.is_some() {
            return Ok(None);
        }

        let model = run_schema::Model {
            id: Uuid::new_v4().to_string(),
            automationId: automation.id.clone(),
            scheduledFor: scheduled_for,
            triggerKind: trigger.to_string(),
            runAsKind: automation.runAsKind.clone(),
            runAsUserId: automation.runAsUserId.clone(),
            // 认领 ≠ 开跑：真正的开始时间由前端就绪后调 `toTouchRun` 补写。
            // 这里留 NULL，才能把「事件丢了、从未执行」与「跑过但没回写」区分开
            // （见 `toReapStale` 的两条分支）。
            startedAt: None,
            finishedAt: None,
            status: automation_run_status::RUNNING.to_string(),
            sessionId: None,
            // 流水线 / 单模式的首阶段由前端开会话后写；这里先按任务定义给个起点
            phase: Some(if automation.planThenGoal {
                MODE_PLAN.to_string()
            } else {
                automation.mode.clone()
            }),
            output: None,
            error: None,
            createdAt: now_ms,
        };
        run_schema::Entity::insert(run_schema::ActiveModel::from(model.clone()))
            .exec(db)
            .await?;

        let mut active: schema::ActiveModel = automation.clone().into();
        active.lastRunAt = Set(Some(now_ms));
        active.lastStatus = Set(Some(automation_run_status::RUNNING.to_string()));
        active.lastError = Set(None);
        active.updatedAt = Set(now_ms);
        active.update(db).await?;
        Ok(Some(model))
    }
}

/// crontab 的日字段里 `L` = 当月最后一天（2 月按 28 / 29 天）。`cron` crate 不支持，
/// 这里在交给它之前自己算 —— 否则用户选「每月最后一天」只能退化成「每月 31 号」，
/// 2 / 4 / 6 / 9 / 11 月会被静默跳过，而界面上看不出任何异常。
///
/// 只认 5 段表达式（分 时 L 月 周）：带秒的写法没有可视化入口，也不属于标准 crontab。
/// 返回 `None` 表示日字段不是 `L`，调用方继续走 `cron` crate。
fn next_last_day(
    schedule: &str,
    zone: &Tz,
    after: &DateTime<Tz>,
) -> Result<Option<i64>, Exception> {
    let fields: Vec<&str> = schedule.split_whitespace().collect();
    let day_index = match fields.len() {
        5 => 2,
        6 | 7 => 3,
        _ => return Ok(None),
    };
    if !fields[day_index].eq_ignore_ascii_case("L") {
        return Ok(None);
    }
    if fields.len() != 5 {
        return Err(Exception::Validation(
            "「每月最后一天」请用 5 段表达式：分 时 L 月 周".to_string(),
        ));
    }
    let minute = last_day_ordinal(fields[0], "分钟", 59)?;
    let hour = last_day_ordinal(fields[1], "小时", 23)?;
    // 同时限定星期没有确定语义（是「最后一天且周一」还是「最后一个周一」？），直接拒绝
    if fields[4] != "*" {
        return Err(Exception::Validation(
            "「每月最后一天」不能再限定星期".to_string(),
        ));
    }
    let months = last_day_months(fields[3])?;

    // 往后找 24 个月：月份限定到某一个月时（如 `L 3`）也够找到下一个
    for step in 0..=24i32 {
        let cursor = after.year() * 12 + after.month0() as i32 + step;
        let year = cursor.div_euclid(12);
        let month = cursor.rem_euclid(12) as u32 + 1;
        if let Some(allowed) = months.as_ref() {
            if !allowed.contains(&month) {
                continue;
            }
        }
        let Some(day) = last_day_of_month(year, month) else {
            continue;
        };
        let Some(naive) = NaiveDate::from_ymd_opt(year, month, day)
            .and_then(|date| date.and_hms_opt(hour, minute, 0))
        else {
            continue;
        };
        let Some(candidate) = resolve_local(zone, naive) else {
            continue;
        };
        if candidate.timestamp_millis() > after.timestamp_millis() {
            return Ok(Some(candidate.timestamp_millis()));
        }
    }
    Err(Exception::Validation("这个表达式不会再触发".to_string()))
}

/// 「最后一天」里只接受单个数字（`*` / 步进 / 区间留给「自定义」）
fn last_day_ordinal(field: &str, name: &str, max: u32) -> Result<u32, Exception> {
    let value = field.parse::<u32>().map_err(|_| {
        Exception::Validation(format!("「每月最后一天」的{name}只支持单个数字：{field}"))
    })?;
    if value > max {
        return Err(Exception::Validation(format!(
            "「每月最后一天」的{name}超出范围：{field}"
        )));
    }
    Ok(value)
}

/// 月字段：`*` → 每个月；`3` / `3,6,9` → 限定到这些月份
fn last_day_months(field: &str) -> Result<Option<Vec<u32>>, Exception> {
    if field == "*" {
        return Ok(None);
    }
    let mut months = Vec::new();
    for part in field.split(',') {
        let month = last_day_ordinal(part, "月份", 12)?;
        if month == 0 {
            return Err(Exception::Validation(format!("月份里没有 0：{field}")));
        }
        months.push(month);
    }
    Ok(Some(months))
}

fn last_day_of_month(year: i32, month: u32) -> Option<u32> {
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .and_then(|first| first.pred_opt())
        .map(|last| last.day())
}

/// 本地时间 → 带时区时间。夏令时整段跳过的那个小时（`LocalResult::None`）往后挪一小时，
/// 别让这个月的任务凭空消失。
fn resolve_local(zone: &Tz, naive: NaiveDateTime) -> Option<DateTime<Tz>> {
    match zone.from_local_datetime(&naive) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => zone
            .from_local_datetime(&(naive + Duration::hours(1)))
            .earliest(),
    }
}

/// `cron` crate 要求带秒（6–7 段），而用户习惯 5 段 crontab：补一个 `0` 秒再解析。
fn expand(schedule: &str) -> Result<String, Exception> {
    let fields: Vec<&str> = schedule.split_whitespace().collect();
    match fields.len() {
        5 => Ok(format!("0 {}", fields.join(" "))),
        6 | 7 => Ok(fields.join(" ")),
        _ => Err(Exception::Validation(
            "定时表达式需要 5 段：分 时 日 月 周".to_string(),
        )),
    }
}

fn truncate(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_string();
    }
    // 按字符切，避免把多字节汉字截断成乱码
    value.chars().take(limit).collect()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use chrono::{Datelike, Timelike};
    use sea_orm::Database;

    use super::*;

    async fn fresh_db() -> Arc<sea_orm::DatabaseConnection> {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory sqlite");
        let connection = Arc::new(db);
        cogito_database::migration::run(&connection)
            .await
            .expect("migration should succeed");
        connection
    }

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("合法时间")
            .timestamp_millis()
    }

    fn input(schedule: &str) -> AutomationInput {
        AutomationInput {
            id: None,
            name: "每日整理".to_string(),
            prompt: "整理昨天的知识库变更".to_string(),
            knowledgeBaseId: None,
            workspaceId: None,
            approval: None,
            providerId: None,
            modelId: None,
            mode: None,
            goalBudget: None,
            planThenGoal: None,
            planFilePath: None,
            schedule: schedule.to_string(),
            timezone: Some("Asia/Shanghai".to_string()),
            enabled: Some(true),
            owner: None,
            runAsKind: None,
            runAsUserId: None,
            tenantId: None,
        }
    }

    #[test]
    fn five_field_cron_is_interpreted_in_task_timezone() {
        // 2026-10-27 08:00 CST 之后的下一次 09:00 = 01:00 UTC
        let after = at(2026, 10, 27, 0, 0);
        let next = Service::toNext("0 9 * * *", "Asia/Shanghai", after).expect("应能算出下一次");
        assert_eq!(next, at(2026, 10, 27, 1, 0));
        // 同一个表达式在纽约（当时 UTC-4）是 13:00 UTC
        let ny = Service::toNext("0 9 * * *", "America/New_York", after).expect("应能算出下一次");
        assert_eq!(ny, at(2026, 10, 27, 13, 0));
    }

    #[test]
    fn cron_with_seconds_is_accepted_too() {
        let after = at(2026, 10, 27, 0, 0);
        let next = Service::toNext("30 0 9 * * *", "Asia/Shanghai", after).expect("6 段也应接受");
        let local = Utc.timestamp_millis_opt(next).single().expect("合法时间");
        assert_eq!((local.hour(), local.minute(), local.second()), (1, 0, 30));
    }

    #[test]
    fn bad_schedule_and_timezone_are_rejected() {
        let after = at(2026, 10, 27, 0, 0);
        assert!(Service::toNext("每分钟", "Asia/Shanghai", after).is_err());
        assert!(Service::toNext("0 9 * *", "Asia/Shanghai", after).is_err());
        assert!(Service::toNext("0 9 * * *", "Mars/Base", after).is_err());
    }

    #[test]
    fn last_day_of_month_follows_the_calendar() {
        let zone = "Asia/Shanghai";
        // 1 / 2 / 4 月分别是 31 / 28 / 30 天：不能固化成某一个数字
        assert_eq!(
            Service::toNext("0 9 L * *", zone, at(2026, 1, 15, 0, 0)).expect("1 月最后一天"),
            at(2026, 1, 31, 1, 0)
        );
        assert_eq!(
            Service::toNext("0 9 L * *", zone, at(2026, 2, 1, 0, 0)).expect("2 月最后一天"),
            at(2026, 2, 28, 1, 0)
        );
        assert_eq!(
            Service::toNext("0 9 L * *", zone, at(2026, 4, 1, 0, 0)).expect("4 月最后一天"),
            at(2026, 4, 30, 1, 0)
        );
        // 闰年 2 月是 29 号
        assert_eq!(
            Service::toNext("0 9 L * *", zone, at(2028, 2, 1, 0, 0)).expect("闰年 2 月最后一天"),
            at(2028, 2, 29, 1, 0)
        );
        // 严格晚于 after：正好落在触发点上要跳到下个月
        assert_eq!(
            Service::toNext("0 9 L * *", zone, at(2026, 1, 31, 1, 0)).expect("跳过已发生的时刻"),
            at(2026, 2, 28, 1, 0)
        );
        // 月份限定：3 月最后一天，跨年也要找得到
        assert_eq!(
            Service::toNext("0 9 L 3 *", zone, at(2026, 4, 1, 0, 0)).expect("限定 3 月"),
            at(2027, 3, 31, 1, 0)
        );
        // 时区跟随任务：纽约 09:00 落到 UTC 13:00（2026-03 已过 DST 切换）
        assert_eq!(
            Service::toNext("0 9 L * *", "America/New_York", at(2026, 4, 1, 0, 0))
                .expect("纽约时区"),
            at(2026, 4, 30, 13, 0)
        );
    }

    #[test]
    fn last_day_rejects_shapes_it_cannot_honour() {
        let after = at(2026, 10, 27, 0, 0);
        // 同一天既最后一天又限定星期：语义不确定，宁可报错
        assert!(Service::toNext("0 9 L * 1", "Asia/Shanghai", after).is_err());
        // 带秒的写法没有可视化入口，别默默按别的意思跑
        assert!(Service::toNext("0 0 9 L * *", "Asia/Shanghai", after).is_err());
        // 范围 / 步进不在面板里，也不假装支持
        assert!(Service::toNext("0 9 L-1 * *", "Asia/Shanghai", after).is_err());
        assert!(Service::toNext("0 9 L 3-6 *", "Asia/Shanghai", after).is_err());
        assert!(Service::toNext("0 25 L * *", "Asia/Shanghai", after).is_err());
    }

    #[tokio::test]
    async fn save_validates_and_schedules() {
        let db = fresh_db().await;
        let mut bad = input("0 9 * * *");
        bad.prompt = "   ".to_string();
        assert!(Service::toSave(db.as_ref(), bad).await.is_err());

        let broken = input("不是 cron");
        assert!(Service::toSave(db.as_ref(), broken).await.is_err());

        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        assert!(saved.nextRunAt.is_some(), "启用中的 client 任务要有排期");
        assert_eq!(saved.owner, automation_owner::CLIENT);
        assert_eq!(saved.runAsKind, automation_run_as::USER);

        // 停用后不再排期
        let off = Service::toSetEnabled(db.as_ref(), saved.id.clone(), false)
            .await
            .expect("停用成功");
        assert!(!off.enabled);
        assert!(off.nextRunAt.is_none());
    }

    #[tokio::test]
    async fn claim_runs_once_and_advances_schedule() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");

        // 未到期：什么都不认领
        assert!(
            Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap() - 1)
                .await
                .expect("claim 成功")
                .is_empty()
        );
        let due_at = saved.nextRunAt.unwrap();
        let claimed = Service::toClaimDue(db.as_ref(), due_at)
            .await
            .expect("claim 成功");
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].run.triggerKind, automation_trigger_kind::SCHEDULE);
        assert_eq!(claimed[0].run.status, automation_run_status::RUNNING);
        assert_eq!(claimed[0].run.scheduledFor, due_at);
        assert!(claimed[0].automation.nextRunAt.unwrap() > due_at, "排期要往前推");

        // 同一时刻再 tick：不得重复
        assert!(
            Service::toClaimDue(db.as_ref(), due_at)
                .await
                .expect("claim 成功")
                .is_empty()
        );
    }

    #[tokio::test]
    async fn missed_slots_only_run_once_as_catchup() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        // 模拟应用关了三天：直接拿很晚的 now 去 claim
        let much_later = saved.nextRunAt.unwrap() + 3 * 24 * 3600 * 1000;
        let claimed = Service::toClaimDue(db.as_ref(), much_later)
            .await
            .expect("claim 成功");
        assert_eq!(claimed.len(), 1, "错过多少轮都只补一次");
        assert_eq!(claimed[0].run.triggerKind, automation_trigger_kind::CATCHUP);
        assert!(claimed[0].automation.nextRunAt.unwrap() > much_later);
    }

    #[tokio::test]
    async fn finish_writes_back_to_run_and_automation() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let claimed = Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap())
            .await
            .expect("claim 成功");
        let run = claimed[0].run.clone();

        let done = Service::toFinish(
            db.as_ref(),
            FinishInput {
                runId: run.id.clone(),
                output: Some("整理完成".to_string()),
                error: None,
            },
        )
        .await
        .expect("回写成功");
        assert_eq!(done.status, automation_run_status::SUCCEEDED);
        assert_eq!(done.output.as_deref(), Some("整理完成"));
        assert!(done.finishedAt.is_some());

        let list = Service::toList(db.as_ref()).await.expect("列出任务");
        assert_eq!(list[0].lastStatus.as_deref(), Some(automation_run_status::SUCCEEDED));
    }

    #[tokio::test]
    async fn manual_run_works_even_when_disabled() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let disabled = Service::toSetEnabled(db.as_ref(), saved.id.clone(), false)
            .await
            .expect("停用成功");

        let due = Service::toRunNow(db.as_ref(), disabled.id.clone())
            .await
            .expect("手动执行应可用");
        assert_eq!(due.run.triggerKind, automation_trigger_kind::MANUAL);
        // 手动执行不改排期
        let after = Service::toList(db.as_ref()).await.expect("列出任务");
        assert!(after[0].nextRunAt.is_none());
    }

    #[tokio::test]
    async fn stale_running_runs_are_reaped() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let claimed = Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap())
            .await
            .expect("claim 成功");
        // 认领时不再写开跑时间（认领 ≠ 开跑），这里按真实流程补写一次
        Service::toTouchRun(db.as_ref(), claimed[0].run.id.clone())
            .await
            .expect("补写开跑时间");
        let started = Service::toListRuns(db.as_ref(), Some(saved.id.clone()), None)
            .await
            .expect("读回记录")[0]
            .startedAt
            .expect("开跑时间已补写");

        // 刚跑完还没回写：不算陈旧
        assert_eq!(
            Service::toReapStale(db.as_ref(), started + 1_000, 60_000)
                .await
                .expect("收尸成功"),
            0
        );
        assert_eq!(
            Service::toReapStale(db.as_ref(), started + 120_000, 60_000)
                .await
                .expect("收尸成功"),
            1
        );
        let runs = Service::toListRuns(db.as_ref(), Some(saved.id.clone()), None)
            .await
            .expect("列出记录");
        assert_eq!(runs[0].status, automation_run_status::FAILED);
        assert!(runs[0].error.is_some());
    }

    #[tokio::test]
    async fn remove_cascades_runs() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        Service::toRunNow(db.as_ref(), saved.id.clone())
            .await
            .expect("手动执行");

        assert_eq!(
            Service::toRemove(db.as_ref(), saved.id.clone())
                .await
                .expect("删除成功"),
            1
        );
        assert!(
            Service::toListRuns(db.as_ref(), Some(saved.id), None)
                .await
                .expect("列出记录")
                .is_empty(),
            "执行记录应随任务级联删除"
        );
    }

    #[tokio::test]
    async fn approval_and_workspace_are_persisted() {
        let db = fresh_db().await;
        let mut draft = input("0 9 * * *");
        draft.approval = Some(APPROVAL_AUTO.to_string());
        draft.workspaceId = Some("ws-1".to_string());
        let saved = Service::toSave(db.as_ref(), draft).await.expect("保存成功");
        assert_eq!(saved.approval, APPROVAL_AUTO);
        assert_eq!(saved.workspaceId.as_deref(), Some("ws-1"));

        // 缺省只读：老任务、以及没显式选过授权的任务都锁在只读
        let plain = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        assert_eq!(plain.approval, APPROVAL_READONLY);
        assert!(plain.workspaceId.is_none());
    }

    #[tokio::test]
    async fn auto_approval_requires_workspace_and_ask_is_rejected() {
        let db = fresh_db().await;
        // 自动批准 = 无人值守的写权限：没有工作目录就不许放开
        let mut no_workspace = input("0 9 * * *");
        no_workspace.approval = Some(APPROVAL_AUTO.to_string());
        assert!(Service::toSave(db.as_ref(), no_workspace).await.is_err());

        // 任务里没有「询问审批」：没人能应答
        let mut asking = input("0 9 * * *");
        asking.approval = Some("ask".to_string());
        assert!(Service::toSave(db.as_ref(), asking).await.is_err());
    }

    #[tokio::test]
    async fn runs_can_be_listed_across_tasks() {
        let db = fresh_db().await;
        let first = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let second = Service::toSave(db.as_ref(), input("0 10 * * *"))
            .await
            .expect("保存成功");
        Service::toRunNow(db.as_ref(), first.id.clone())
            .await
            .expect("手动执行");
        Service::toRunNow(db.as_ref(), second.id.clone())
            .await
            .expect("手动执行");

        let mine = Service::toListRuns(db.as_ref(), Some(first.id.clone()), None)
            .await
            .expect("列出记录");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].automationId, first.id);

        // 不指定任务 = 跨任务聚合（页面级「全部记录」）
        let all = Service::toListRuns(db.as_ref(), None, Some(10))
            .await
            .expect("列出记录");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|run| run.automationId == second.id));
    }

    #[test]
    fn cron_year_field_still_parses() {
        let after = at(2026, 10, 27, 0, 0);
        let next = Service::toNext("0 0 9 1 1 * 2027", "Asia/Shanghai", after)
            .expect("7 段应接受");
        let local = Utc.timestamp_millis_opt(next).single().expect("合法时间");
        assert_eq!((local.year(), local.month(), local.day()), (2027, 1, 1));
    }

    #[tokio::test]
    async fn finishing_a_reaped_run_does_not_overwrite_it() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let claimed = Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap())
            .await
            .expect("claim 成功");
        let run = claimed[0].run.clone();
        // 认领后一直没开跑（事件丢了）：按 scheduledFor 起算回收
        Service::toReapStale(
            db.as_ref(),
            run.scheduledFor + 31 * 60 * 1000,
            30 * 60 * 1000,
        )
            .await
            .expect("收尸成功");

        // 回收之后前端才回写成功：不许把失败记录改成成功（两种来源互相覆盖就都不可信了）
        let done = Service::toFinish(
            db.as_ref(),
            FinishInput {
                runId: run.id.clone(),
                output: Some("其实跑完了".to_string()),
                error: None,
            },
        )
        .await
        .expect("回写应幂等");
        assert_eq!(done.status, automation_run_status::FAILED);
        assert!(done.output.is_none());
    }

    #[tokio::test]
    async fn touch_run_records_real_start_and_rejects_finished() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let claimed = Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap())
            .await
            .expect("claim 成功");
        let run = claimed[0].run.clone();

        let touched = Service::toTouchRun(db.as_ref(), run.id.clone())
            .await
            .expect("排队结束、真正开跑");
        assert!(run.startedAt.is_none(), "认领不等于开跑：认领时没有开跑时间");
        assert!(touched.startedAt.is_some(), "补写后才有开跑时间");

        Service::toFinish(
            db.as_ref(),
            FinishInput {
                runId: run.id.clone(),
                output: Some("完成".to_string()),
                error: None,
            },
        )
        .await
        .expect("回写成功");
        assert!(
            Service::toTouchRun(db.as_ref(), run.id).await.is_err(),
            "已结束的记录不许再标开始"
        );
    }

    #[tokio::test]
    async fn get_returns_single_task() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let found = Service::toGet(db.as_ref(), saved.id.clone())
            .await
            .expect("查询成功");
        assert_eq!(found.map(|item| item.id), Some(saved.id));
        assert!(Service::toGet(db.as_ref(), "nope".to_string())
            .await
            .expect("查询成功")
            .is_none());
    }

    /// 认领了却从来没开跑（事件丢了 / 页面正在重载）：不能永远停在「执行中」。
    #[tokio::test]
    async fn claimed_but_never_started_run_is_reaped_as_failed() {
        let db = fresh_db().await;
        let saved = Service::toSave(db.as_ref(), input("0 9 * * *"))
            .await
            .expect("保存成功");
        let claimed = Service::toClaimDue(db.as_ref(), saved.nextRunAt.unwrap())
            .await
            .expect("claim 成功");
        let run = claimed[0].run.clone();
        assert!(run.startedAt.is_none(), "认领时不该有开跑时间");

        // 还在宽限期内：不算陈旧
        assert_eq!(
            Service::toReapStale(db.as_ref(), run.scheduledFor + 1_000, 60_000)
                .await
                .expect("收尸成功"),
            0
        );
        // 超过阈值：标失败，且文案点明「没被执行」
        assert_eq!(
            Service::toReapStale(db.as_ref(), run.scheduledFor + 120_000, 60_000)
                .await
                .expect("收尸成功"),
            1
        );
        let runs = Service::toListRuns(db.as_ref(), Some(saved.id.clone()), None)
            .await
            .expect("列出记录");
        assert_eq!(runs[0].status, automation_run_status::FAILED);
        assert!(runs[0].startedAt.is_none(), "没开跑就不该被补上开跑时间");
        assert!(
            runs[0].error.as_deref().unwrap_or_default().contains("没有被执行"),
            "文案要说清是「没被执行」，而不是「跑完没回写」"
        );
    }
}

