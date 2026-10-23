//! 个人租户订阅：付费档位的开通 / 续订 / 取消与生效判定。
//!
//! 配额不落库，档位对应的日 token 配额由 `gateway.plan_daily_token_quota` 提供；
//! 本模块负责「某租户此刻生效的是哪个档位」以及「该租户当前生效的日配额」。
//!
//! 两条通道，边界不同：
//! - **请求通道**（[`SubscriptionService::subscribe`] / `list` / `cancel` / `quota`）收 [`TenantCtx`]，
//!   权限由 `authz` 判定，事务由调用方（控制器）提交。
//! - **可信通道**（[`SubscriptionService::grant`]）只收 [`TenantScope`]：调用方已确权（支付验签后核销、
//!   平台代开），因此这里不做权限判定，只保证「写进作用域自己的租户」。
//!
//! 热路径按 `tenant_id` 读档位（[`SubscriptionService::active_plan`] 等）自带**只读短作用域**：
//! 查完即回滚归还连接，绝不跨外部调用持有。

use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use entity::{subscription, tenant};
use fred::interfaces::KeysInterface;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter,
    QueryOrder, Set,
};
use uuid::Uuid;

use authz::{Action, Permission, Resource};
use identity::{TenantId, UserId};

use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::tenant::{TenantCtx, TenantScope};
use crate::services::subscription::schema::{QuotaR, SubscribeP, SubscriptionR};
use crate::services::tenant::schema::TenantType;
use crate::utils::code::{business, external, request, resource};
use crate::utils::db::is_unique_violation;

/// 看订阅与配额：租户内任何有效成员都可以（含 MEMBER）。
pub(crate) const READ_SUBSCRIPTION: Permission =
    Permission::new(Resource::Subscription, Action::Read);
/// 开通 / 取消订阅：仅 OWNER。花钱与配额口径只由 Owner 决定，ADMIN 连自助开通也不放行。
const MANAGE_SUBSCRIPTION: Permission = Permission::new(Resource::Subscription, Action::Manage);

/// 订阅状态：生效中 / 已取消 / 已到期。
pub const ACTIVE: &str = "ACTIVE";
pub const CANCELED: &str = "CANCELED";
pub const EXPIRED: &str = "EXPIRED";

/// 生效档位缓存：档位极少变动，避免聊天热路径每次都查库。
const PLAN_CACHE_TTL_SECS: i64 = 60;
/// 缓存「无生效订阅」的哨兵值（Redis 空值无法区分 miss）。
const PLAN_CACHE_NONE: &str = "-";

#[derive(Debug, thiserror::Error)]
pub enum SubscriptionError {
    #[error("Tenant not found")]
    TenantNotFound,
    #[error("Only personal tenants can subscribe")]
    NotPersonal,
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Subscription not found")]
    NotFound,
    #[error("Subscription conflict")]
    Conflict,
    #[error("Plan requires payment")]
    PlanRequiresPayment,
    #[error("Database error: {0}")]
    Db(String),
}

impl From<SubscriptionError> for Exception {
    fn from(err: SubscriptionError) -> Self {
        match err {
            SubscriptionError::TenantNotFound => {
                Exception::custom(resource::NOT_FOUND, "租户不存在")
            }
            SubscriptionError::NotPersonal => Exception::custom(
                request::INVALID_PARAMETER_VALUE,
                "仅个人租户可订阅，团队租户使用全局配额",
            ),
            SubscriptionError::BadParam(msg) => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, msg)
            }
            SubscriptionError::NotFound => Exception::custom(resource::NOT_FOUND, "订阅不存在"),
            SubscriptionError::Conflict => {
                Exception::custom(resource::ALREADY_EXISTS, "该租户已有生效订阅，请重试")
            }
            SubscriptionError::PlanRequiresPayment => Exception::custom(
                business::payment::PLAN_NOT_PURCHASABLE,
                "该档位需通过支付开通",
            ),
            SubscriptionError::Db(msg) => {
                tracing::error!(error = %msg, "subscription database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

/// 日配额来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuotaSource {
    /// 生效订阅档位
    Plan,
    /// 个人租户免费档
    Free,
    /// 全局兜底（团队租户 / 无租户身份）
    Global,
}

impl QuotaSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "PLAN",
            Self::Free => "FREE",
            Self::Global => "GLOBAL",
        }
    }
}

/// 某租户当前生效的日配额。
#[derive(Debug, Clone)]
pub struct QuotaInfo {
    pub source: QuotaSource,
    pub plan: Option<String>,
    pub limit: i64,
}

/// 此刻生效的订阅（供支付等模块计算续费基数）。
#[derive(Debug, Clone)]
pub struct ActiveSubscription {
    pub id: Uuid,
    pub plan: String,
    /// 到期时间；`None` = 永久有效
    pub expires_at: Option<DateTime<FixedOffset>>,
}

pub struct SubscriptionService;

impl SubscriptionService {
    /// 开通 / 续订（自助入口）。
    ///
    /// 自助开通只对**未定价档位**开放：`pay.plans` 里定了价（`amount > 0`）的档位必须走支付流程，
    /// 否则任何租户管理员都能绕过收银台白拿付费配额。平台管理员保留代开通道（客服补单 / 本地联调）。
    ///
    /// 事务由调用方提交：出错返回即随作用域回滚，不会留下半截订阅。
    ///
    /// # Errors
    /// 权限不足 403；档位需支付 500408；租户不存在 404；档位未配置或到期时间非法 400。
    pub async fn subscribe(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
        req: SubscribeP,
    ) -> Result<SubscriptionR, Exception> {
        ctx.require(MANAGE_SUBSCRIPTION)?;
        ensure_self_service_allowed(config, &req.plan, ctx.principal().is_platform_admin())?;
        Self::grant(ctx.scope(), config, redis, ctx.principal().user_id(), req)
            .await
            .map_err(Exception::from)
    }

    /// 开通 / 续订（可信通道：支付核销后开通、平台管理员代开）。
    ///
    /// 与 [`Self::subscribe`] 的唯一区别是**不做「已定价档位需走支付」的守卫**，也不做权限判定 ——
    /// 鉴权与「钱有没有到」由调用方保证（支付模块在验签 + 核对金额之后才会调到这里）。
    /// 租户取自作用域本身，调用方无法把它写到别的租户名下。
    ///
    /// 订阅**创建即生效**（`createdAt` 即生效时间）。同一租户同一时刻最多一条 ACTIVE 订阅，故在同一个
    /// 事务内：
    /// 1. 旧 ACTIVE 订阅——已过期的标 `EXPIRED`；否则标 `CANCELED` 并把 `expiresAt`
    ///    **截断到当前时间**（新订阅即刻接管，续费不浪费剩余天数）；
    /// 2. 插入新订阅。
    ///
    /// # Errors
    /// 租户不存在 404；非个人租户 400；档位未配置 / 到期时间非法 400；并发开通 409；库错 500。
    pub async fn grant(
        scope: &TenantScope,
        config: &Configure,
        redis: &RedisPool,
        actor: UserId,
        req: SubscribeP,
    ) -> Result<SubscriptionR, SubscriptionError> {
        let tenant_id = scope.tenant_id();
        let tx = scope.tx();

        let tenant = tenant::Entity::find_by_id(tenant_id.as_uuid())
            .one(tx)
            .await
            .map_err(db_err)?
            .ok_or(SubscriptionError::TenantNotFound)?;
        if !TenantType::is_personal(&tenant.tenant_type) {
            return Err(SubscriptionError::NotPersonal);
        }

        // 档位必须在配置里有配额，避免写入无法计费的档位名。
        if config.gateway_plan_daily_token_quota(&req.plan).is_none() {
            return Err(SubscriptionError::BadParam(format!(
                "档位不存在或未配置配额: {}",
                req.plan
            )));
        }

        let now = Utc::now().fixed_offset();
        let expires_at = match req.expires_at {
            Some(millis) => Some(from_millis(millis)?),
            None => None,
        };
        if expires_at.is_some_and(|end| end <= now) {
            return Err(SubscriptionError::BadParam(
                "到期时间须晚于当前时间".to_string(),
            ));
        }

        // 读旧订阅与写新订阅在同一事务内，避免并发开通各自读到「无生效订阅」后双开
        for old in active_rows(tx).await.map_err(db_err)? {
            // 已过期的按 EXPIRED 归档；未结束的统一截断到当前时间（新订阅即刻接管）
            let expired = old.expires_at.is_some_and(|end| end <= now);
            let mut active: subscription::ActiveModel = old.into();
            active.status = Set(if expired { EXPIRED } else { CANCELED }.to_string());
            if !expired {
                active.expires_at = Set(Some(now));
            }
            active.updated_at = Set(now);
            active.updater = Set(Some(actor.as_uuid()));
            active.update(tx).await.map_err(db_err)?;
        }

        let model = subscription::ActiveModel {
            id: Set(Uuid::new_v4()),
            tenant_id: Set(tenant_id.as_uuid()),
            plan: Set(req.plan),
            status: Set(ACTIVE.to_string()),
            expires_at: Set(expires_at),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(actor.as_uuid())),
            updated_at: Set(now),
            updater: Set(Some(actor.as_uuid())),
        }
        .insert(tx)
        .await
        .map_err(|err| {
            if is_unique_violation(&err) {
                SubscriptionError::Conflict
            } else {
                db_err(err)
            }
        })?;

        cache_invalidate(redis, tenant_id.as_uuid()).await;

        Ok(to_r(model))
    }

    /// 租户订阅历史（含已取消 / 已到期），按创建时间倒序。
    ///
    /// 顺带把「已过 `expiresAt` 但仍为 ACTIVE」的订阅标记为 `EXPIRED`（惰性清理，无需定时任务）——
    /// 这条清理是写操作，因此调用方成功时必须提交事务。
    ///
    /// # Errors
    /// 权限不足 403（非成员由守卫拦下）；库错 500。
    pub async fn list(ctx: &TenantCtx) -> Result<Vec<SubscriptionR>, Exception> {
        ctx.require(READ_SUBSCRIPTION)?;

        let tx = ctx.tx();
        expire_stale(tx).await.map_err(err_db)?;

        let rows = subscription::Entity::find()
            .order_by_desc(subscription::Column::CreatedAt)
            .all(tx)
            .await
            .map_err(err_db)?;

        Ok(rows.into_iter().map(to_r).collect())
    }

    /// 取消订阅：状态置 CANCELED，并把有效期截断到当前时间。
    ///
    /// # Errors
    /// 权限不足 403（仅 OWNER）；订阅不存在（或不属于本租户）404；库错 500。
    pub async fn cancel(
        ctx: &TenantCtx,
        redis: &RedisPool,
        subscription_id: Uuid,
    ) -> Result<(), Exception> {
        ctx.require(MANAGE_SUBSCRIPTION)?;

        let tx = ctx.tx();
        let model = subscription::Entity::find_by_id(subscription_id)
            .one(tx)
            .await
            .map_err(err_db)?
            .ok_or(SubscriptionError::NotFound)
            .map_err(Exception::from)?;

        let now = Utc::now().fixed_offset();
        let expires_at = match model.expires_at {
            Some(end) if end < now => end,
            _ => now,
        };
        let mut active: subscription::ActiveModel = model.into();
        active.status = Set(CANCELED.to_string());
        active.expires_at = Set(Some(expires_at));
        active.updated_at = Set(now);
        active.updater = Set(Some(ctx.principal().user_id().as_uuid()));
        active.update(tx).await.map_err(err_db)?;

        cache_invalidate(redis, ctx.tenant_id().as_uuid()).await;
        Ok(())
    }

    /// 当前生效配额（接口用；带租户类型与鉴权）。
    ///
    /// # Errors
    /// 权限不足 403；库错 500。
    pub async fn quota(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
    ) -> Result<QuotaR, Exception> {
        ctx.require(READ_SUBSCRIPTION)?;

        let tx = ctx.tx();
        let tenant_id = ctx.tenant_id();
        let member = tenant::Entity::find_by_id(tenant_id.as_uuid())
            .one(tx)
            .await
            .map_err(err_db)?
            .ok_or(SubscriptionError::TenantNotFound)
            .map_err(Exception::from)?;
        let info = quota_in(tx, config, redis, tenant_id)
            .await
            .map_err(err_db)?
            .unwrap_or_else(|| global_quota(config));

        Ok(QuotaR {
            tenant_id: tenant_id.to_string(),
            tenant_type: member.tenant_type,
            source: info.source.as_str().to_string(),
            plan: info.plan,
            daily_token_quota: info.limit,
        })
    }

    /// 此刻生效的档位名（无有效订阅则 `None`）。走 Redis 缓存（TTL 60s）。
    ///
    /// 缓存故障时降级为直查数据库，不打断聊天链路。
    ///
    /// # Errors
    /// 库错时返回底层错误。
    pub async fn active_plan(
        db: &Storage,
        redis: &RedisPool,
        tenant_id: Uuid,
    ) -> Result<Option<String>, DbErr> {
        let scope = TenantScope::open(db, TenantId::from_uuid(tenant_id)).await?;
        let plan = active_plan_in(scope.tx(), redis, scope.tenant_id()).await;
        end_read(scope).await;
        plan
    }

    /// 此刻生效的订阅记录（无有效订阅则 `None`）。不走缓存。
    ///
    /// 自带只读短作用域：查完即结束，不把连接留在调用方手里。
    ///
    /// # Errors
    /// 库错时返回底层错误。
    pub async fn active_subscription(
        db: &Storage,
        tenant_id: Uuid,
    ) -> Result<Option<ActiveSubscription>, DbErr> {
        let scope = TenantScope::open(db, TenantId::from_uuid(tenant_id)).await?;
        let found = Self::active_subscription_in(scope.tx()).await;
        end_read(scope).await;
        found
    }

    /// 给定事务里此刻生效的订阅（无有效订阅则 `None`）。不走缓存，也不自己做事务收尾。
    ///
    /// 支付开通要在**同一个事务**里先算续费基数、再写新订阅，读与写必须共用一个连接；
    /// 由调用方（[`crate::services::payment::service::PaymentService`]）持有事务与提交时机。
    ///
    /// # Errors
    /// 库错时返回底层错误。
    pub(crate) async fn active_subscription_in(
        tx: &DatabaseTransaction,
    ) -> Result<Option<ActiveSubscription>, DbErr> {
        let now = Utc::now().fixed_offset();

        active_rows(tx).await.map(|rows| {
            rows.into_iter()
                .find(|row| in_effect(row, now))
                .map(|row| ActiveSubscription {
                    id: row.id,
                    plan: row.plan,
                    expires_at: row.expires_at,
                })
        })
    }
}

/// 全局兜底配额：没有租户身份（账号作用域），或租户不是个人租户时的日窗上限。
///
/// 只定义一次：聊天拦截（`gateway` 热路径）与只读自助查询都取它，
/// 保证「界面显示的剩余」与「服务端拦截的数字」同源。
pub(crate) fn global_quota(config: &Configure) -> QuotaInfo {
    QuotaInfo {
        source: QuotaSource::Global,
        plan: None,
        limit: config.gateway_daily_token_quota(),
    }
}

/// 个人租户的配额口径；非个人租户 / 租户不存在返回 `None`（调用方回落到 [`global_quota`]）。
///
/// 由**持有租户作用域**的调用方给出事务：`tenant` 与 `subscription` 两行都按 `tenantID`
/// 读，脱离作用域会读到 0 行（策略见迁移里的 `tenant_isolation`）。
pub(crate) async fn quota_in(
    tx: &DatabaseTransaction,
    config: &Configure,
    redis: &RedisPool,
    tenant_id: TenantId,
) -> Result<Option<QuotaInfo>, DbErr> {
    let Some(tenant) = tenant::Entity::find_by_id(tenant_id.as_uuid())
        .one(tx)
        .await?
    else {
        return Ok(None);
    };
    if !TenantType::is_personal(&tenant.tenant_type) {
        return Ok(None);
    }

    Ok(Some(match active_plan_in(tx, redis, tenant_id).await? {
        Some(plan) => match config.gateway_plan_daily_token_quota(&plan) {
            Some(limit) => QuotaInfo {
                source: QuotaSource::Plan,
                plan: Some(plan),
                limit,
            },
            // 未知档位（配置删改后残留）回落免费档，避免超发
            None => QuotaInfo {
                source: QuotaSource::Free,
                plan: None,
                limit: config.gateway_free_daily_token_quota(),
            },
        },
        None => QuotaInfo {
            source: QuotaSource::Free,
            plan: None,
            limit: config.gateway_free_daily_token_quota(),
        },
    }))
}

/// 生效档位（带缓存）：先在给定作用域内查。
pub(crate) async fn active_plan_in(
    tx: &DatabaseTransaction,
    redis: &RedisPool,
    tenant_id: TenantId,
) -> Result<Option<String>, DbErr> {
    let key = plan_cache_key(tenant_id.as_uuid());
    if let Some(cached) = cache_get(redis, &key).await {
        return Ok(if cached == PLAN_CACHE_NONE {
            None
        } else {
            Some(cached)
        });
    }

    let plan = query_active_plan(tx).await?;
    cache_set(redis, &key, plan.as_deref()).await;
    Ok(plan)
}

/// 只读作用域结束：显式回滚归还连接；回滚失败只记日志，不覆盖主流程的结果。
async fn end_read(scope: TenantScope) {
    if let Err(err) = scope.rollback().await {
        tracing::warn!(error = %err, "subscription read scope rollback failed");
    }
}

fn plan_cache_key(tenant_id: Uuid) -> String {
    format!("gateway:plan:{tenant_id}")
}

async fn cache_get(redis: &RedisPool, key: &str) -> Option<String> {
    match redis.pool().get::<Option<String>, _>(key).await {
        Ok(value) => value,
        Err(err) => {
            tracing::warn!(error = %err, "plan cache get failed");
            None
        }
    }
}

async fn cache_set(redis: &RedisPool, key: &str, plan: Option<&str>) {
    let value = plan.unwrap_or(PLAN_CACHE_NONE);
    let result: Result<(), fred::error::Error> = async {
        let _: () = redis.pool().set(key, value, None, None, false).await?;
        let _: () = redis.pool().expire(key, PLAN_CACHE_TTL_SECS, None).await?;
        Ok(())
    }
    .await;
    if let Err(err) = result {
        tracing::warn!(error = %err, "plan cache set failed");
    }
}

/// 失效生效档位缓存。订阅发生变更的模块（如支付开通成功后）应主动调用，避免档位短暂不一致。
pub async fn cache_invalidate(redis: &RedisPool, tenant_id: Uuid) {
    let key = plan_cache_key(tenant_id);
    let result: Result<(), fred::error::Error> = async {
        let _: () = redis.pool().del(key).await?;
        Ok(())
    }
    .await;
    if let Err(err) = result {
        tracing::warn!(error = %err, "plan cache invalidate failed");
    }
}

/// 本作用域内状态为 ACTIVE 的订阅（未按时间过滤），按创建时间倒序。
///
/// 不带 `tenantID` 条件：作用域（`app.tenant_id` + 行级策略）已经把可见行限定在当前租户。
async fn active_rows(tx: &DatabaseTransaction) -> Result<Vec<subscription::Model>, DbErr> {
    subscription::Entity::find()
        .filter(subscription::Column::Status.eq(ACTIVE))
        .filter(subscription::Column::ArchivedAt.is_null())
        .order_by_desc(subscription::Column::CreatedAt)
        .all(tx)
        .await
}

/// 实查当前生效档位（走 DB，不带缓存）。
async fn query_active_plan(tx: &DatabaseTransaction) -> Result<Option<String>, DbErr> {
    let now = Utc::now().fixed_offset();
    let rows = active_rows(tx).await?;
    Ok(rows
        .into_iter()
        .find(|row| in_effect(row, now))
        .map(|row| row.plan))
}

/// 惰性把已过 `expiresAt` 的 ACTIVE 订阅标记为 EXPIRED。
async fn expire_stale(tx: &DatabaseTransaction) -> Result<(), DbErr> {
    let now = Utc::now().fixed_offset();
    for row in active_rows(tx).await? {
        if row.expires_at.is_some_and(|end| end <= now) {
            let mut active: subscription::ActiveModel = row.into();
            active.status = Set(EXPIRED.to_string());
            active.updated_at = Set(now);
            active.update(tx).await?;
        }
    }
    Ok(())
}

/// 是否仍有效：未到期（`expiresAt` 为空表示永久）。订阅创建即生效，因此无「未开始」状态。
fn in_effect(row: &subscription::Model, now: DateTime<FixedOffset>) -> bool {
    match row.expires_at {
        Some(end) => end > now,
        None => true,
    }
}

/// 自助开通守卫：已定价（`amount > 0`）的档位只能由支付回调开通。
///
/// 判断只看 `pay.plans` 这一张表：配置里删掉定价即恢复自助开通，不需要改代码。
fn ensure_self_service_allowed(
    config: &Configure,
    plan: &str,
    platform_admin: bool,
) -> Result<(), SubscriptionError> {
    if platform_admin {
        return Ok(());
    }
    match config.pay_plan(plan) {
        Some(spec) if spec.amount > 0 => Err(SubscriptionError::PlanRequiresPayment),
        _ => Ok(()),
    }
}

fn from_millis(millis: i64) -> Result<DateTime<FixedOffset>, SubscriptionError> {
    Utc.timestamp_millis_opt(millis)
        .single()
        .map(|dt| dt.fixed_offset())
        .ok_or_else(|| SubscriptionError::BadParam("时间戳无效".to_string()))
}

fn to_r(m: subscription::Model) -> SubscriptionR {
    SubscriptionR {
        id: m.id.to_string(),
        tenant_id: m.tenant_id.to_string(),
        plan: m.plan,
        status: m.status,
        expires_at: m.expires_at.map(|end| end.timestamp_millis()),
        created_at: m.created_at.timestamp_millis(),
        updated_at: m.updated_at.timestamp_millis(),
    }
}

fn db_err(err: DbErr) -> SubscriptionError {
    SubscriptionError::Db(err.to_string())
}

/// 请求通道的数据库错误：直接落成 500，不再在服务层里转来转去。
fn err_db(err: DbErr) -> Exception {
    db_err(err).into()
}

#[cfg(test)]
mod tests {
    use super::{SubscriptionError, ensure_self_service_allowed};
    use crate::configures::configure::{Configure, PayPlanConfig};

    /// 定价档位：`pay.plans` 里有 `amount > 0` 的条目。
    fn priced_config(plan: &str) -> Configure {
        let mut config = Configure::default();
        config.pay.plans.insert(
            plan.to_string(),
            PayPlanConfig {
                amount: 1990,
                duration_days: Some(30),
                label: None,
            },
        );
        config
    }

    #[test]
    fn self_service_cannot_open_a_priced_plan() {
        let config = priced_config("pro");

        assert!(matches!(
            ensure_self_service_allowed(&config, "pro", false),
            Err(SubscriptionError::PlanRequiresPayment)
        ));
    }

    #[test]
    fn platform_admin_may_open_a_priced_plan() {
        let config = priced_config("pro");

        assert!(ensure_self_service_allowed(&config, "pro", true).is_ok());
    }

    #[test]
    fn self_service_still_opens_unpriced_or_unlisted_plans() {
        // 未在 pay.plans 里：可自助开通
        assert!(ensure_self_service_allowed(&priced_config("pro"), "team", false).is_ok());

        // 在 pay.plans 里但未定价（amount <= 0）：视为不可售，可自助开通
        let mut config = Configure::default();
        config.pay.plans.insert(
            "legacy".to_string(),
            PayPlanConfig {
                amount: 0,
                duration_days: Some(30),
                label: None,
            },
        );
        assert!(ensure_self_service_allowed(&config, "legacy", false).is_ok());
    }
}
