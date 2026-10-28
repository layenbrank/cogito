#![allow(non_snake_case)]

//! 定时任务的读写与排期。
//!
//! 三条不变量：
//! 1. **保存即校验**：cron / 时区写错在保存时就报 `Validation`，不等 worker tick 才发现；
//! 2. **只补一次**：`nextRunAt` 推进到「下一个未来的时间点」，错过多轮也只执行一次；
//! 3. **一次触发一条记录**：`(automationId, scheduledFor)` 唯一，重复 tick / 动手执行都不会重跑。

use chrono::{TimeZone, Utc};
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

/// 一次 tick 最多认领多少个任务，避免某台机器积压时一次性拉起一堆会话
const CLAIM_LIMIT: u64 = 20;

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
        let parsed = Schedule::from_str(&expand(schedule)?)
            .map_err(|error| Exception::Validation(format!("定时表达式不合法：{error}")))?;
        let local = Utc
            .timestamp_millis_opt(after_ms)
            .single()
            .ok_or_else(|| Exception::Validation("时间戳不合法".to_string()))?
            .with_timezone(&zone);
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
        let prompt = input.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err(Exception::Validation("任务内容不能为空".to_string()));
        }
        let schedule = input.schedule.trim().to_string();
        let timezone = input
            .timezone
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_TIMEZONE.to_string());
        let enabled = input.enabled.unwrap_or(true);
        let owner = input.owner.unwrap_or_else(|| automation_owner::CLIENT.to_string());
        if !matches!(owner.as_str(), automation_owner::CLIENT | automation_owner::GOOSE | automation_owner::CLOUD) {
            return Err(Exception::Validation(format!("不支持的执行方：{owner}")));
        }
        let run_as_kind = input.runAsKind.unwrap_or_else(|| automation_run_as::USER.to_string());
        if !matches!(run_as_kind.as_str(), automation_run_as::USER | automation_run_as::TENANT) {
            return Err(Exception::Validation(format!("不支持的执行身份：{run_as_kind}")));
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

    /// 收尸：前端没把结果回写（应用被关掉/会话中断）的 running 记录。
    pub async fn toReapStale<C: ConnectionTrait + TransactionTrait>(
        db: &C,
        now_ms: i64,
        stale_ms: i64,
    ) -> Result<u64, Exception> {
        let stale = run_schema::Entity::find()
            .filter(run_schema::Column::Status.eq(automation_run_status::RUNNING))
            .filter(run_schema::Column::StartedAt.lt(now_ms - stale_ms))
            .all(db)
            .await?;
        let mut reaped = 0;
        for run in stale {
            let mut active: run_schema::ActiveModel = run.clone().into();
            active.status = Set(automation_run_status::FAILED.to_string());
            active.error = Set(Some("执行没有回写结果（应用退出或会话中断）".to_string()));
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
        automation_id: String,
        limit: Option<u64>,
    ) -> Result<Vec<run_schema::Model>, Exception> {
        Ok(run_schema::Entity::find()
            .filter(run_schema::Column::AutomationId.eq(automation_id))
            .order_by_desc(run_schema::Column::ScheduledFor)
            .limit(limit.unwrap_or(20))
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
            startedAt: Some(now_ms),
            finishedAt: None,
            status: automation_run_status::RUNNING.to_string(),
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
        let started = claimed[0].run.startedAt.unwrap();

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
        let runs = Service::toListRuns(db.as_ref(), saved.id.clone(), None)
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
            Service::toListRuns(db.as_ref(), saved.id, None)
                .await
                .expect("列出记录")
                .is_empty(),
            "执行记录应随任务级联删除"
        );
    }

    #[test]
    fn cron_year_field_still_parses() {
        let after = at(2026, 10, 27, 0, 0);
        let next = Service::toNext("0 0 9 1 1 * 2027", "Asia/Shanghai", after)
            .expect("7 段应接受");
        let local = Utc.timestamp_millis_opt(next).single().expect("合法时间");
        assert_eq!((local.year(), local.month(), local.day()), (2027, 1, 1));
    }
}

