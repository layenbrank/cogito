//! 服务端定时任务：CRUD、排期计算、到期认领与回写。
//!
//! 三条与客户端一致的约定，外加一条服务端专属的：
//! 1. **保存即校验**：cron / 时区写错立刻 400，不留到 worker tick；
//! 2. **只补一次**：`nextRunAt` 推到「下一个未来时间点」，错过多轮也只跑一次；
//! 3. **认领用 CAS**：`UPDATE ... WHERE id = ? AND nextRunAt = ?`；多副本并发时只有一个能推进排期，
//!    比 `SELECT ... FOR UPDATE` 更省锁（认领本身是毫秒级，冲突重试即可）；
//! 4. **跨租户扫描走平台事务**：worker 不认识「当前租户」，与 outbox 发布器同一通道。

use chrono::{DateTime, TimeZone, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use entity::scheduled_job::{self, Entity as Jobs};
use identity::TenantId;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};
use std::str::FromStr;
use uuid::Uuid;

use authz::{Action, Permission, Resource};

use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::tenant::TenantCtx;
use crate::services::schedule::schema::{JobPatchP, JobP, JobR};
use crate::utils::code::business::schedule as code;

/// 缺省时区：任务落库时就写死，不依赖进程环境。
pub const DEFAULT_TIMEZONE: &str = "Asia/Shanghai";

/// 一轮最多认领多少个任务：多副本时不该让一台机器把所有活都揽走
const CLAIM_LIMIT: u64 = 20;

/// 迟到多久仍算准点（超过就是补跑，只影响日志与审计，不影响执行次数）
const CATCHUP_GRACE_MS: i64 = 120_000;

const WRITE_JOB: Permission = Permission::new(Resource::AgentTask, Action::Write);
const READ_JOB: Permission = Permission::new(Resource::AgentTask, Action::Read);

pub struct Service;

impl Service {
    /// 下一个触发时间（epoch ms，严格晚于 `after_ms`），按 `timezone` 解释表达式。
    ///
    /// # Errors
    /// cron 段数不对、表达式不合法、时区不认识。
    pub fn next_run(cron: &str, timezone: &str, after_ms: i64) -> Result<i64, Exception> {
        let zone: Tz = timezone.trim().parse().map_err(|_| {
            Exception::custom(code::SCHEDULE_INVALID, format!("时区不合法：{timezone}"))
        })?;
        let parsed = Schedule::from_str(&expand(cron)?).map_err(|error| {
            Exception::custom(code::SCHEDULE_INVALID, format!("定时表达式不合法：{error}"))
        })?;
        let local = Utc
            .timestamp_millis_opt(after_ms)
            .single()
            .ok_or_else(|| Exception::custom(code::SCHEDULE_INVALID, "时间戳不合法"))?
            .with_timezone(&zone);
        let next = parsed.after(&local).next().ok_or_else(|| {
            Exception::custom(code::SCHEDULE_INVALID, "这个表达式不会再触发")
        })?;
        Ok(next.timestamp_millis())
    }

    pub async fn list(ctx: &TenantCtx) -> Result<Vec<JobR>, Exception> {
        ctx.require(READ_JOB)?;
        let rows = Jobs::find()
            .filter(scheduled_job::Column::TenantId.eq(ctx.tenant_id().as_uuid()))
            .order_by_asc(scheduled_job::Column::CreatedAt)
            .all(ctx.tx()).await.map_err(db_error)?;
        Ok(rows.iter().map(JobR::of).collect())
    }

    /// 新建或整体替换；`enabled` 且排期算得出来才有 `nextRunAt`
    pub async fn save(ctx: &TenantCtx, req: JobP) -> Result<JobR, Exception> {
        ctx.require(WRITE_JOB)?;

        let name = req.name.trim().to_owned();
        let prompt = req.prompt.trim().to_owned();
        if name.is_empty() || prompt.is_empty() {
            return Err(Exception::custom(
                code::JOB_INVALID,
                "任务名称与内容都不能为空",
            ));
        }
        let cron = req.cron.trim().to_owned();
        let timezone = req
            .timezone
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_TIMEZONE.to_owned());
        let enabled = req.enabled.unwrap_or(true);
        let run_as_kind = req.run_as_kind.unwrap_or_else(|| "user".to_owned());
        if !matches!(run_as_kind.as_str(), "user" | "tenant") {
            return Err(Exception::custom(
                code::JOB_INVALID,
                "执行身份只能是 user 或 tenant",
            ));
        }
        let run_as_user_id = match req.run_as_user_id {
            Some(value) => Some(parse_uuid(&value)?),
            None => None,
        };

        let now = Utc::now().fixed_offset();
        let next_run_at = if enabled {
            Some(Self::next_run(&cron, &timezone, now.timestamp_millis())?)
        } else {
            None
        };

        let row = match req.id {
            Some(id) => {
                let job_id = parse_uuid(&id)?;
                let existing = Jobs::find_by_id(job_id)
                    .filter(scheduled_job::Column::TenantId.eq(ctx.tenant_id().as_uuid()))
                    .one(ctx.tx()).await.map_err(db_error)?
                    .ok_or_else(|| {
                        Exception::custom(code::JOB_NOT_FOUND, "任务不存在")
                    })?;
                let mut active: scheduled_job::ActiveModel = existing.into();
                active.name = Set(name);
                active.prompt = Set(prompt);
                active.cron = Set(cron);
                active.timezone = Set(timezone);
                active.enabled = Set(enabled);
                active.run_as_kind = Set(run_as_kind);
                active.run_as_user_id = Set(run_as_user_id);
                active.next_run_at = Set(next_run_at);
                active.updated_at = Set(now);
                active.update(ctx.tx()).await.map_err(db_error)?
            }
            None => {
                let model = scheduled_job::Model {
                    id: Uuid::new_v4(),
                    tenant_id: ctx.tenant_id().as_uuid(),
                    creator: ctx.principal().user_id().as_uuid(),
                    name,
                    prompt,
                    cron,
                    timezone,
                    enabled,
                    run_as_kind,
                    run_as_user_id,
                    next_run_at,
                    last_run_at: None,
                    last_status: None,
                    last_error: None,
                    last_task_id: None,
                    created_at: now,
                    updated_at: now,
                };
                scheduled_job::Entity::insert(scheduled_job::ActiveModel::from(model.clone()))
                    .exec(ctx.tx()).await.map_err(db_error)?;
                model
            }
        };
        Ok(JobR::of(&row))
    }

    /// 局部更新：`enabled` 变化或 cron/时区变化时重排；停用即清空排期
    pub async fn patch(ctx: &TenantCtx, id: &str, patch: JobPatchP) -> Result<JobR, Exception> {
        ctx.require(WRITE_JOB)?;
        let job_id = parse_uuid(id)?;
        let existing = Jobs::find_by_id(job_id)
            .filter(scheduled_job::Column::TenantId.eq(ctx.tenant_id().as_uuid()))
            .one(ctx.tx()).await.map_err(db_error)?
            .ok_or_else(|| Exception::custom(code::JOB_NOT_FOUND, "任务不存在"))?;

        let cron = patch.cron.unwrap_or_else(|| existing.cron.clone());
        let timezone = patch.timezone.unwrap_or_else(|| existing.timezone.clone());
        let enabled = patch.enabled.unwrap_or(existing.enabled);
        let now = Utc::now().fixed_offset();
        // 停用清排期；启用或改了表达式就从「现在」重排（不补停用期间错过的时间点）
        let next_run_at = if enabled {
            Some(Self::next_run(&cron, &timezone, now.timestamp_millis())?)
        } else {
            None
        };

        let mut active: scheduled_job::ActiveModel = existing.into();
        if let Some(name) = patch.name {
            active.name = Set(name.trim().to_owned());
        }
        if let Some(prompt) = patch.prompt {
            active.prompt = Set(prompt.trim().to_owned());
        }
        if let Some(kind) = patch.run_as_kind {
            if !matches!(kind.as_str(), "user" | "tenant") {
                return Err(Exception::custom(
                    code::JOB_INVALID,
                    "执行身份只能是 user 或 tenant",
                ));
            }
            active.run_as_kind = Set(kind);
        }
        if let Some(user_id) = patch.run_as_user_id {
            active.run_as_user_id = Set(Some(parse_uuid(&user_id)?));
        }
        active.cron = Set(cron);
        active.timezone = Set(timezone);
        active.enabled = Set(enabled);
        active.next_run_at = Set(next_run_at);
        active.updated_at = Set(now);
        Ok(JobR::of(&active.update(ctx.tx()).await.map_err(db_error)?))
    }

    pub async fn remove(ctx: &TenantCtx, id: &str) -> Result<u64, Exception> {
        ctx.require(WRITE_JOB)?;
        let job_id = parse_uuid(id)?;
        let result = scheduled_job::Entity::delete_many()
            .filter(scheduled_job::Column::Id.eq(job_id))
            .filter(scheduled_job::Column::TenantId.eq(ctx.tenant_id().as_uuid()))
            .exec(ctx.tx()).await.map_err(db_error)?;
        if result.rows_affected == 0 {
            return Err(Exception::custom(code::JOB_NOT_FOUND, "任务不存在"));
        }
        Ok(result.rows_affected)
    }

    /// 认领到期任务（worker 用，跨租户）。
    ///
    /// 用 CAS 推进排期：`rows_affected == 0` 说明别的副本先拿走了这一格，直接跳过。
    /// 认领即把 `lastStatus` 落成 `running`，前端刷新时能看到「正在跑」。
    ///
    /// # Errors
    /// 库连接或读写失败。
    pub async fn claim_due(storage: &Storage, now_ms: i64) -> Result<Vec<scheduled_job::Model>, Exception> {
        let tx = storage.platform_tx().await.map_err(db_error)?;
        let due = Jobs::find()
            .filter(scheduled_job::Column::Enabled.eq(true))
            .filter(scheduled_job::Column::NextRunAt.lte(now_ms))
            .order_by_asc(scheduled_job::Column::NextRunAt)
            .limit(CLAIM_LIMIT)
            .all(&tx).await.map_err(db_error)?;

        let mut claimed = Vec::new();
        for job in due {
            let scheduled_for = job.next_run_at.unwrap_or(now_ms);
            let next = Self::next_run(&job.cron, &job.timezone, now_ms.max(scheduled_for))?;
            if now_ms - scheduled_for > CATCHUP_GRACE_MS {
                tracing::info!(
                    job = %job.id,
                    late_ms = now_ms - scheduled_for,
                    "定时任务补跑（错过的时间点只补一次）"
                );
            }

            let updated = scheduled_job::Entity::update_many()
                .col_expr(
                    scheduled_job::Column::NextRunAt,
                    sea_orm::sea_query::Expr::value(Some(next)),
                )
                .col_expr(
                    scheduled_job::Column::LastRunAt,
                    sea_orm::sea_query::Expr::value(Some(now_ms)),
                )
                .col_expr(
                    scheduled_job::Column::LastStatus,
                    sea_orm::sea_query::Expr::value(Some("running".to_owned())),
                )
                .col_expr(
                    scheduled_job::Column::UpdatedAt,
                    sea_orm::sea_query::Expr::value::<chrono::DateTime<chrono::FixedOffset>>(
                        Utc::now().fixed_offset(),
                    ),
                )
                .filter(scheduled_job::Column::Id.eq(job.id))
                // CAS：只有还停在原来那一格才算我们抢到
                .filter(scheduled_job::Column::NextRunAt.eq(job.next_run_at))
                .exec(&tx).await.map_err(db_error)?;
            if updated.rows_affected == 0 {
                continue;
            }
            claimed.push(job);
        }
        tx.commit().await.map_err(db_error)?;
        Ok(claimed)
    }

    /// 回写一次执行结果（worker 用，跨租户）
    pub async fn finish(
        storage: &Storage,
        id: Uuid,
        error: Option<&str>,
        task_id: Option<Uuid>,
    ) -> Result<(), Exception> {
        let tx = storage.platform_tx().await.map_err(db_error)?;
        let mut active = scheduled_job::ActiveModel {
            id: Set(id),
            last_status: Set(Some(
                if error.is_some() { "failed" } else { "succeeded" }.to_owned(),
            )),
            last_error: Set(error.map(str::to_owned)),
            last_task_id: Set(task_id),
            updated_at: Set(Utc::now().fixed_offset()),
            ..Default::default()
        };
        active.update(&tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(())
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, Exception> {
    Uuid::parse_str(value).map_err(|_| Exception::custom(code::JOB_NOT_FOUND, "任务不存在"))
}

/// 库错误 → 500：本域没有「部分成功」的读写，一律整体失败
fn db_error(error: DbErr) -> Exception {
    Exception::custom(crate::utils::code::system::INTERNAL_ERROR, error.to_string())
}

/// `cron` crate 要求带秒（6–7 段），而用户习惯 5 段 crontab：补一个 `0` 秒再解析。
fn expand(cron: &str) -> Result<String, Exception> {
    let fields: Vec<&str> = cron.split_whitespace().collect();
    match fields.len() {
        5 => Ok(format!("0 {}", fields.join(" "))),
        6 | 7 => Ok(fields.join(" ")),
        _ => Err(Exception::custom(
            code::SCHEDULE_INVALID,
            "定时表达式需要 5 段：分 时 日 月 周",
        )),
    }
}

/// 供 worker 判断「这一格什么时候该跑」时复用（测试也走它）
#[must_use]
pub fn to_local(millis: i64, timezone: &str) -> Option<DateTime<Tz>> {
    let zone: Tz = timezone.parse().ok()?;
    Some(Utc.timestamp_millis_opt(millis).single()?.with_timezone(&zone))
}

#[cfg(test)]
mod tests {
    use chrono::{Datelike, Timelike};

    use super::*;

    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0)
            .single()
            .expect("合法时间")
            .timestamp_millis()
    }

    #[test]
    fn five_field_cron_uses_task_timezone() {
        // 2026-10-27 00:00 UTC = 08:00 CST，下一次 09:00 CST = 01:00 UTC
        assert_eq!(
            Service::next_run("0 9 * * *", "Asia/Shanghai", at(2026, 10, 27, 0, 0)).unwrap(),
            at(2026, 10, 27, 1, 0)
        );
        // 同一表达式在纽约（UTC-4）是 13:00 UTC
        assert_eq!(
            Service::next_run("0 9 * * *", "America/New_York", at(2026, 10, 27, 0, 0)).unwrap(),
            at(2026, 10, 27, 13, 0)
        );
    }

    #[test]
    fn seconds_and_year_fields_are_accepted() {
        let next = Service::next_run("30 0 9 * * *", "Asia/Shanghai", at(2026, 10, 27, 0, 0))
            .expect("6 段应接受");
        let local = to_local(next, "Asia/Shanghai").expect("能转回本地");
        assert_eq!(
            (local.hour(), local.minute(), local.second()),
            (9, 0, 30)
        );

        let yearly = Service::next_run("0 0 9 1 1 * 2027", "Asia/Shanghai", at(2026, 10, 27, 0, 0))
            .expect("7 段应接受");
        let local = to_local(yearly, "Asia/Shanghai").expect("能转回本地");
        assert_eq!((local.year(), local.month(), local.day()), (2027, 1, 1));
    }

    #[test]
    fn bad_expression_or_zone_is_rejected() {
        assert!(Service::next_run("每分钟", "Asia/Shanghai", 0).is_err());
        assert!(Service::next_run("0 9 * *", "Asia/Shanghai", 0).is_err());
        assert!(Service::next_run("0 9 * * *", "Mars/Base", 0).is_err());
    }
}
