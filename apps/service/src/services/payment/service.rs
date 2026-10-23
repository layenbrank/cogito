//! 支付订单：下单 → 渠道凭证 → 回调/查单核销 → 开通订阅。
//!
//! 安全与一致性要点（支付域不可放松）：
//! - **服务端权威定价**：客户端只提交 `plan` + `channel`，金额来自 `pay.plans` 并快照落库；
//! - **回调必验签**：验签 → 金额 / 币种核对 → 才允许改单，验签失败一律不改状态；
//! - **幂等**：同一订单重复回调 / 重复查单只开通一次；`PAID` 但未开通（异常中断）可自愈重试；
//! - **惰性关单**：超过 `expiresAt` 的订单在下单 / 查单时被关闭，无需定时任务；
//! - **迟到支付**：订单已关闭后收到成功回调仍会开通（钱已到账），但记 `remark` 并告警，便于对账。
//!
//! 两条例外通道，入口凭证不同：
//! - **请求通道**收 [`TenantCtx`]：权限由 `authz` 判定，事务由控制器提交；
//! - **匿名回调**收 [`PaymentNotifyScope`]：订单号（能力键）是唯一入口凭证，守卫在同一个事务里
//!   把它换成租户作用域。
//!
//! 渠道是外部系统，作用域**不得跨越它持有**：下单 / 查单在外部调用前用 [`TenantCtx::renew`] 收尾、
//! 调用后另起一段。出错时由 [`PaymentError::keeps_writes`] 说明「这一段里有没有必须落库的写入」，
//! 事务持有者据此提交或回滚 —— 已经收到的钱和留下的账务痕迹，不能因为最终返回了错误码就一起丢掉。

use chrono::{Duration, Utc};
use entity::{payment_order, tenant};
use identity::{TenantId, UserId};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set,
};
use uuid::Uuid;

use authz::{Action, Permission, Resource};

use crate::clients::redis::RedisPool;
use crate::configures::configure::{Configure, PayPlanConfig};
use crate::databases::database::Storage;
use crate::filters::exception::Exception;
use crate::guards::payment::PaymentNotifyScope;
use crate::guards::tenant::{TenantCtx, TenantScope};
use crate::services::payment::channel::{
    self, ALIPAY, ChannelError, NotifyInput, NotifyOutcome, PrepayInput, WECHAT, availability,
};
use crate::services::payment::schema::{CatalogChannelR, CatalogPlanR, CatalogR, OrderP, OrderR};
use crate::services::subscription::schema::SubscribeP;
use crate::services::subscription::service::{
    READ_SUBSCRIPTION, SubscriptionError, SubscriptionService, active_plan_in, cache_invalidate,
};
use crate::services::tenant::schema::TenantType;
use crate::utils::code::{auth as auth_codes, business, external, request, resource};

/// 待支付。
pub const PENDING: &str = "PENDING";
/// 已支付（并已开通订阅）。
pub const PAID: &str = "PAID";
/// 已关闭（超时 / 主动关单）。
pub const CLOSED: &str = "CLOSED";

/// 平台结算币种（微信、支付宝当前仅支持人民币）。
pub const CURRENCY: &str = "CNY";

/// 订单号随机段长度（配合秒级时间戳，冲突概率可忽略且订单号仍在 32 字符内）。
const ORDER_NO_RANDOM_LEN: usize = 8;

/// 订单列表一次最多返回的条数（设置页只需最近几条）。
const ORDER_LIST_MAX: u64 = 50;

/// 看支付目录：与看订阅同权（任何有效成员，含 MEMBER）——能看到自己的配额却看不到价格是说不通的。
const READ_PAYMENT_CATALOG: Permission = READ_SUBSCRIPTION;
/// 看订单（详情 / 列表 / 查单）：账单属于租户经营数据，MEMBER 不看。
const READ_PAYMENT_ORDER: Permission = Permission::new(Resource::PaymentOrder, Action::Read);
/// 下单 / 关单：花钱只由 OWNER 决定。
const MANAGE_PAYMENT_ORDER: Permission = Permission::new(Resource::PaymentOrder, Action::Manage);

#[derive(Debug, thiserror::Error)]
pub enum PaymentError {
    #[error("Tenant not found")]
    TenantNotFound,
    #[error("Only personal tenants can purchase")]
    NotPersonal,
    #[error("Insufficient permission")]
    Forbidden,
    #[error("Invalid parameter: {0}")]
    BadParam(String),
    #[error("Plan not purchasable: {0}")]
    PlanNotPurchasable(String),
    #[error("Order not found")]
    OrderNotFound,
    #[error("Order closed")]
    OrderClosed,
    #[error("Order expired")]
    OrderExpired,
    #[error("Amount mismatch")]
    AmountMismatch,
    #[error("Channel unavailable: {0}")]
    ChannelUnavailable(String),
    #[error("Signature invalid: {0}")]
    Signature(String),
    #[error("Upstream error: {0}")]
    Upstream(String),
    #[error("Database error: {0}")]
    Db(String),
    /// 已收款却没能开通订阅：订单保持 `PAID` + 空 `subscriptionID`，等下次查单自愈或人工处理。
    ///
    /// 对外与 [`PaymentError::Db`] 同码同文案（历史契约不变），分成两个变体只为让
    /// [`PaymentError::keeps_writes`] 能表态「这条账必须留痕」。
    #[error("Subscription activation failed: {0}")]
    ActivationFailed(String),
    /// 下单失败后订单已被关闭：保留**原错误**的状态码与文案，只额外声明「本段有必须落库的写入」。
    #[error("{0}")]
    ClosedByFailure(Box<Self>),
}

impl PaymentError {
    /// 这个错误是否伴随**必须落库**的写入。
    ///
    /// 支付域的失败分两类，事务持有者（控制器 / 回调守卫）据此决定提交还是回滚：
    /// - 已经动过账 —— 订单被翻转成 `PAID` / `CLOSED`、金额不符留了 `remark`、开通失败留了 `remark`、
    ///   下单失败把订单关掉了 —— 必须提交，否则出现「钱收了却没有记录」；
    /// - 什么都没写，或者语句报错（含唯一索引冲突）**中止了事务** —— 回滚即可，此时提交也写不进东西。
    ///
    /// 判断刻意写在错误类型上而不是散落在调用点：新增错误变体时必须在这里显式表态。
    #[must_use]
    pub const fn keeps_writes(&self) -> bool {
        matches!(
            self,
            Self::AmountMismatch
                | Self::OrderExpired
                | Self::OrderClosed
                | Self::ActivationFailed(_)
                | Self::ClosedByFailure(_)
        )
    }
}

impl From<PaymentError> for Exception {
    fn from(err: PaymentError) -> Self {
        match err {
            PaymentError::TenantNotFound => Exception::custom(resource::NOT_FOUND, "租户不存在"),
            PaymentError::NotPersonal => Exception::custom(
                request::INVALID_PARAMETER_VALUE,
                "仅个人租户可购买档位，团队租户使用全局配额",
            ),
            PaymentError::Forbidden => {
                Exception::custom(auth_codes::INSUFFICIENT_PERMISSIONS, "权限不足")
            }
            PaymentError::BadParam(msg) => Exception::custom(request::INVALID_PARAMETER_VALUE, msg),
            PaymentError::PlanNotPurchasable(msg) => {
                Exception::custom(business::payment::PLAN_NOT_PURCHASABLE, msg)
            }
            PaymentError::OrderNotFound => {
                Exception::custom(business::payment::ORDER_NOT_FOUND, "订单不存在")
            }
            PaymentError::OrderClosed => {
                Exception::custom(business::payment::ORDER_CLOSED, "订单已关闭，请重新下单")
            }
            PaymentError::OrderExpired => {
                Exception::custom(business::payment::ORDER_EXPIRED, "订单已过期，请重新下单")
            }
            PaymentError::AmountMismatch => Exception::custom(
                business::payment::AMOUNT_MISMATCH,
                "支付金额与订单不一致，已挂起待人工核对",
            ),
            PaymentError::ChannelUnavailable(reason) => Exception::custom(
                business::payment::CHANNEL_UNAVAILABLE,
                format!("支付渠道不可用：{reason}"),
            ),
            PaymentError::Signature(msg) => Exception::custom(
                business::payment::SIGNATURE_INVALID,
                format!("支付签名校验失败：{msg}"),
            ),
            PaymentError::Upstream(msg) => {
                tracing::error!(error = %msg, "payment upstream error");
                Exception::custom(business::payment::UPSTREAM_ERROR, "支付渠道返回错误")
            }
            PaymentError::Db(msg) => {
                tracing::error!(error = %msg, "payment database error");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            PaymentError::ActivationFailed(msg) => {
                tracing::error!(error = %msg, "payment subscription activation failed");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
            PaymentError::ClosedByFailure(cause) => Exception::from(*cause),
        }
    }
}

impl From<ChannelError> for PaymentError {
    fn from(err: ChannelError) -> Self {
        match err {
            ChannelError::Unavailable(reason) => Self::ChannelUnavailable(reason),
            ChannelError::Unsupported(code) => Self::BadParam(format!("不支持的支付渠道: {code}")),
            ChannelError::Signature(msg) => Self::Signature(msg),
            ChannelError::Malformed(msg) => Self::BadParam(msg),
            ChannelError::Upstream(msg) => Self::Upstream(msg),
        }
    }
}

pub struct PaymentService;

impl PaymentService {
    /// 价格 / 渠道目录：客户端渲染「档位 → 渠道 → 下单」的唯一数据源。
    ///
    /// # Errors
    /// 权限不足 403；库错 500。
    pub async fn catalog(
        ctx: &TenantCtx,
        config: &Configure,
        redis: &RedisPool,
    ) -> Result<CatalogR, PaymentError> {
        ctx.require(READ_PAYMENT_CATALOG)
            .map_err(|_| PaymentError::Forbidden)?;

        let plans = config
            .pay_plans()
            .map(|(name, spec)| {
                let reason = unsellable_reason(config, name, spec);
                CatalogPlanR {
                    plan: name.clone(),
                    label: spec.label.clone().unwrap_or_else(|| name.clone()),
                    amount: spec.amount,
                    currency: CURRENCY.to_string(),
                    duration_days: spec.duration_days,
                    daily_token_quota: config.gateway_plan_daily_token_quota(name).unwrap_or(0),
                    purchasable: reason.is_none(),
                    reason,
                }
            })
            .collect::<Vec<_>>();

        let channels = [WECHAT, ALIPAY]
            .iter()
            .map(|code| {
                let (code, label, enabled, reason) = availability(config, code);
                CatalogChannelR {
                    code,
                    label,
                    enabled,
                    reason,
                }
            })
            .collect();

        Ok(CatalogR {
            currency: CURRENCY.to_string(),
            order_ttl_secs: config.pay_order_ttl_secs(),
            plans,
            channels,
            current_plan: active_plan_in(ctx.tx(), redis, ctx.tenant_id())
                .await
                .map_err(db_err)?,
        })
    }

    /// 下单：返回可渲染二维码的 `codeUrl`。
    ///
    /// 同一用户 + 档位 + 渠道的未过期待支付订单会被复用，避免反复点击产生一堆并行订单。
    ///
    /// 事务切两段：第一段把订单落库，第二段（渠道返回后）写二维码。渠道是外部系统，
    /// 作用域不跨越它持有；第一段先提交，即使渠道调用失败或进程中断，也不会留下「永远没有凭证」
    /// 的待支付订单——重试下单时会补一次。
    ///
    /// # Errors
    /// 权限不足 403（仅 OWNER）；非个人租户 / 档位不可售 / 渠道不可用 400；渠道错误 5xx；库错 500。
    pub async fn create(
        ctx: &mut TenantCtx,
        db: &Storage,
        config: &Configure,
        req: OrderP,
    ) -> Result<OrderR, PaymentError> {
        ctx.require(MANAGE_PAYMENT_ORDER)
            .map_err(|_| PaymentError::Forbidden)?;
        require_personal(ctx.tx(), ctx.tenant_id()).await?;

        let channel_code = channel::require_ready(config, &req.channel)?.code;
        let spec = config
            .pay_plan(&req.plan)
            .ok_or_else(|| PaymentError::PlanNotPurchasable("档位未定价或已下线".to_string()))?;
        if let Some(reason) = unsellable_reason(config, &req.plan, spec) {
            return Err(PaymentError::PlanNotPurchasable(reason));
        }

        let tenant_id = ctx.tenant_id().as_uuid();
        let user_id = ctx.principal().user_id().as_uuid();
        close_stale(ctx.tx()).await?;

        // 不带 `tenantID` 条件：作用域（`app.tenant_id` + 行级策略）已经把可见行限定在本租户。
        if let Some(existing) = payment_order::Entity::find()
            .filter(payment_order::Column::UserId.eq(user_id))
            .filter(payment_order::Column::Plan.eq(req.plan.as_str()))
            .filter(payment_order::Column::Channel.eq(channel_code))
            .filter(payment_order::Column::Status.eq(PENDING))
            .filter(payment_order::Column::ArchivedAt.is_null())
            .one(ctx.tx())
            .await
            .map_err(db_err)?
        {
            // 已有二维码直接复用；下单时上游抖动导致无凭证的订单则补一次
            if existing.code_url.is_some() {
                return Ok(to_r(existing, config));
            }
            return Self::prepay_and_store(ctx, db, config, existing).await;
        }

        let now = Utc::now().fixed_offset();
        let order = payment_order::ActiveModel {
            id: Set(Uuid::new_v4()),
            order_no: Set(order_no()),
            tenant_id: Set(tenant_id),
            user_id: Set(user_id),
            plan: Set(req.plan),
            channel: Set(channel_code.to_string()),
            amount: Set(spec.amount),
            currency: Set(CURRENCY.to_string()),
            status: Set(PENDING.to_string()),
            duration_days: Set(spec.duration_days),
            transaction_id: Set(None),
            code_url: Set(None),
            subscription_id: Set(None),
            paid_at: Set(None),
            expires_at: Set(now + Duration::seconds(config.pay_order_ttl_secs() as i64)),
            remark: Set(None),
            archived_at: Set(None),
            created_at: Set(now),
            creator: Set(Some(user_id)),
            updated_at: Set(now),
            updater: Set(Some(user_id)),
        }
        .insert(ctx.tx())
        .await
        .map_err(db_err)?;

        Self::prepay_and_store(ctx, db, config, order).await
    }

    /// 订单详情（租户作用域内的订单号是唯一键，跨租户订单号查不到）。
    ///
    /// # Errors
    /// 权限不足 403；订单不存在 404；库错 500。
    pub async fn get(
        ctx: &TenantCtx,
        config: &Configure,
        order_no: &str,
    ) -> Result<OrderR, PaymentError> {
        ctx.require(READ_PAYMENT_ORDER)
            .map_err(|_| PaymentError::Forbidden)?;

        Ok(to_r(load(ctx.tx(), order_no).await?, config))
    }

    /// 订单列表（按创建时间倒序）：设置页「订单历史」；顺带惰性关单，展示的状态不会过期。
    ///
    /// # Errors
    /// 权限不足 403；库错 500。
    pub async fn list(
        ctx: &TenantCtx,
        config: &Configure,
        limit: u64,
    ) -> Result<Vec<OrderR>, PaymentError> {
        ctx.require(READ_PAYMENT_ORDER)
            .map_err(|_| PaymentError::Forbidden)?;

        close_stale(ctx.tx()).await?;

        let orders = payment_order::Entity::find()
            .filter(payment_order::Column::ArchivedAt.is_null())
            .order_by_desc(payment_order::Column::CreatedAt)
            .limit(limit.clamp(1, ORDER_LIST_MAX))
            .all(ctx.tx())
            .await
            .map_err(db_err)?;
        Ok(orders
            .into_iter()
            .map(|order| to_r(order, config))
            .collect())
    }

    /// 主动查单：回调丢失时的兜底，也是「刷新支付状态」按钮的实现。
    ///
    /// - 已收款未开通（异常中断）→ 自愈补齐订阅；
    /// - 待支付已过期 → 关单；
    /// - 待支付但缺二维码 → 补下单拿新凭证；
    /// - 其余情况向上游查单，成功即核销。
    ///
    /// # Errors
    /// 权限不足 403；订单不存在 404；订单过期 / 已关闭 400；渠道错误 5xx；库错 500。
    pub async fn sync(
        ctx: &mut TenantCtx,
        db: &Storage,
        config: &Configure,
        redis: &RedisPool,
        order_no: &str,
    ) -> Result<OrderR, PaymentError> {
        ctx.require(READ_PAYMENT_ORDER)
            .map_err(|_| PaymentError::Forbidden)?;

        let order = load(ctx.tx(), order_no).await?;

        if order.status == PAID {
            if order.subscription_id.is_some() {
                return Ok(to_r(order, config));
            }
            // 已收款未开通：自愈补齐（写入随作用域提交）
            return Self::settle(ctx.scope(), config, redis, order, None).await;
        }
        if order.status != PENDING {
            return Err(PaymentError::OrderClosed);
        }
        if order.expires_at <= Utc::now().fixed_offset() {
            mark_closed(ctx.tx(), order, "超时未支付", None).await?;
            return Err(PaymentError::OrderExpired);
        }
        if order.code_url.is_none() {
            return Self::prepay_and_store(ctx, db, config, order).await;
        }

        // 上游查单是外部调用：先收尾当前这一段，回来按最新状态核销
        let channel_code = order.channel.clone();
        ctx.renew(db).await.map_err(scope_err)?;

        let remote = channel::query(config, &channel_code, order_no).await?;
        let order = load(ctx.tx(), order_no).await?;
        if remote.paid {
            return Self::settle(ctx.scope(), config, redis, order, remote.transaction_id).await;
        }
        if remote.closed {
            mark_closed(ctx.tx(), order, "上游已关单", None).await?;
            return Err(PaymentError::OrderClosed);
        }
        Ok(to_r(order, config))
    }

    /// 主动关单：用户取消支付。
    ///
    /// # Errors
    /// 权限不足 403（仅 OWNER）；订单不存在 404；订单已支付 400；库错 500。
    pub async fn close(
        ctx: &TenantCtx,
        config: &Configure,
        order_no: &str,
    ) -> Result<OrderR, PaymentError> {
        ctx.require(MANAGE_PAYMENT_ORDER)
            .map_err(|_| PaymentError::Forbidden)?;

        let order = load(ctx.tx(), order_no).await?;
        if order.status == PAID {
            return Err(PaymentError::BadParam(
                "订单已支付，无法关闭；如需退款请走原渠道退款流程".to_string(),
            ));
        }
        if order.status == CLOSED {
            return Ok(to_r(order, config));
        }
        let updater = ctx.principal().user_id().as_uuid();

        Ok(to_r(
            mark_closed(ctx.tx(), order, "用户取消", Some(updater)).await?,
            config,
        ))
    }

    /// 渠道回调：验签 + 核销。
    ///
    /// 回调是匿名入口，订单号是唯一凭证：由 [`PaymentNotifyScope`] 把它反解成租户作用域
    /// （反解不到就是「订单不存在」，不是 500 —— 让渠道停下来，而不是无限重试一个不存在的订单号）。
    ///
    /// 调用方（控制器）负责按渠道约定应答：微信 JSON、支付宝纯文本 `success`，
    /// 且**不能**经过平台响应信封。
    ///
    /// 核销中途可能写下必须留痕的东西，因此「结论」与「提交还是回滚」分开决定：
    /// 由 [`PaymentError::keeps_writes`] 给出答案，最后才把原始错误交给调用方。
    ///
    /// # Errors
    /// 验签失败 / 渠道不匹配 400；订单不存在 404；金额不符 409 级业务错误（已记 `remark`）；库错 500。
    pub async fn notify(
        db: &Storage,
        config: &Configure,
        redis: &RedisPool,
        channel_code: &str,
        input: NotifyInput<'_>,
    ) -> Result<(), PaymentError> {
        let outcome = channel::verify_notify(config, channel_code, &input)?;

        let Some(scope) = PaymentNotifyScope::open(db, &outcome.order_no)
            .await
            .map_err(db_err)?
        else {
            return Err(PaymentError::OrderNotFound);
        };

        let result = Self::handle_notify(&scope, config, redis, channel_code, outcome).await;
        if result.as_ref().err().is_none_or(PaymentError::keeps_writes) {
            scope.commit().await.map_err(db_err)?;
        } else {
            scope.rollback().await.map_err(db_err)?;
        }

        result
    }

    /// 核销主体：跑在回调引导出来的租户作用域里。
    ///
    /// 幂等由两层保证：`PAID` 且已开通直接返回；并发回调只有一次能把订单条件更新成 `PAID`
    /// （见 [`Self::settle`]），未翻转成功的一方回读后接手开通。
    async fn handle_notify(
        scope: &PaymentNotifyScope,
        config: &Configure,
        redis: &RedisPool,
        channel_code: &str,
        outcome: NotifyOutcome,
    ) -> Result<(), PaymentError> {
        let tx = scope.tx();
        let order = payment_order::Entity::find()
            .filter(payment_order::Column::OrderNo.eq(outcome.order_no.as_str()))
            .filter(payment_order::Column::ArchivedAt.is_null())
            .one(tx)
            .await
            .map_err(db_err)?
            .ok_or(PaymentError::OrderNotFound)?;

        // 回调必须来自下单时选定的渠道，否则不予采信
        if channel::find(channel_code).map(|spec| spec.code) != Some(order.channel.as_str()) {
            return Err(PaymentError::Signature(format!(
                "订单 {} 支付渠道不匹配",
                order.order_no
            )));
        }
        if order.status == PAID && order.subscription_id.is_some() {
            return Ok(());
        }
        if !outcome.paid {
            tracing::info!(order_no = %order.order_no, trade_state = "non-success", "payment notify ignored");
            return Ok(());
        }

        // 金额 / 币种核对：不一致绝不开通，留 remark 供人工对账
        if outcome.amount != order.amount || !outcome.currency.eq_ignore_ascii_case(&order.currency)
        {
            let remark = format!(
                "金额不符：应付 {} {}，实收 {} {}",
                order.amount, order.currency, outcome.amount, outcome.currency
            );
            tracing::error!(order_no = %order.order_no, remark = %remark, "payment amount mismatch");
            set_remark(tx, &order, &remark).await?;
            return Err(PaymentError::AmountMismatch);
        }

        if order.status == CLOSED {
            tracing::warn!(
                order_no = %order.order_no,
                "late payment accepted for closed order; activating subscription"
            );
        }

        Self::settle(scope.scope(), config, redis, order, outcome.transaction_id)
            .await
            .map(|_| ())
    }

    /// 向上游下单并把凭证落库；失败即关单，避免留下永远没有二维码的待支付订单。
    ///
    /// 渠道调用发生在两段事务之间：进入时先结束当前这一段（订单已落库），调用后在新的一段里写
    /// 二维码或关单备注。
    async fn prepay_and_store(
        ctx: &mut TenantCtx,
        db: &Storage,
        config: &Configure,
        order: payment_order::Model,
    ) -> Result<OrderR, PaymentError> {
        let subject = subject_of(config, &order);
        let input = PrepayInput {
            order_no: &order.order_no,
            amount: order.amount,
            currency: &order.currency,
            subject: &subject,
            expires_at: order.expires_at,
        };

        ctx.renew(db).await.map_err(scope_err)?;

        match channel::prepay(config, &order.channel, &input).await {
            Ok(code_url) => {
                let now = Utc::now().fixed_offset();
                let mut active: payment_order::ActiveModel = order.into();
                active.code_url = Set(Some(code_url));
                active.updated_at = Set(now);
                let saved = active.update(ctx.tx()).await.map_err(db_err)?;
                Ok(to_r(saved, config))
            }
            Err(err) => {
                let reason = err.to_string();
                tracing::error!(order_no = %order.order_no, error = %reason, "prepay failed");
                mark_closed(ctx.tx(), order, &format!("下单失败：{reason}"), None).await?;
                // 关单备注必须留痕（否则用户看到的是一张永远不过期的待支付订单），
                // 因此保留原错误的映射与文案，只额外声明「本段有写入要保留」。
                Err(PaymentError::ClosedByFailure(Box::new(err.into())))
            }
        }
    }

    /// 核销订单并开通订阅（幂等）。
    ///
    /// 先尝试把订单从 `PENDING` / `CLOSED` **条件更新**为 `PAID`：并发回调只有一次能翻转，
    /// 翻转成功者负责开通订阅；未翻转成功者回读最新状态，若仍未开通则接手开通（自愈）。
    ///
    /// 全程跑在调用方给的作用域里：开通是纯本地写入，不需要跨越外部调用，因此读续费基数与写订阅
    /// 共用同一个事务（不再另开连接）；提交 / 回滚由作用域持有者决定。
    async fn settle(
        scope: &TenantScope,
        config: &Configure,
        redis: &RedisPool,
        order: payment_order::Model,
        transaction_id: Option<String>,
    ) -> Result<OrderR, PaymentError> {
        if order.status == PAID && order.subscription_id.is_some() {
            return Ok(to_r(order, config));
        }

        let now = Utc::now().fixed_offset();
        let transaction = transaction_id.or_else(|| order.transaction_id.clone());
        let tx = scope.tx();
        let order = if order.status == PAID {
            order
        } else {
            let result = payment_order::Entity::update_many()
                .col_expr(
                    payment_order::Column::Status,
                    sea_orm::sea_query::Expr::value(PAID),
                )
                .col_expr(
                    payment_order::Column::PaidAt,
                    sea_orm::sea_query::Expr::value(now),
                )
                .col_expr(
                    payment_order::Column::UpdatedAt,
                    sea_orm::sea_query::Expr::value(now),
                )
                .filter(payment_order::Column::Id.eq(order.id))
                .filter(payment_order::Column::Status.is_in([PENDING, CLOSED]))
                .exec(tx)
                .await
                .map_err(db_err)?;

            let latest = payment_order::Entity::find_by_id(order.id)
                .one(tx)
                .await
                .map_err(db_err)?
                .ok_or(PaymentError::OrderNotFound)?;
            if result.rows_affected == 0 && latest.subscription_id.is_some() {
                return Ok(to_r(latest, config));
            }
            latest
        };

        Self::activate(scope, config, redis, order, transaction).await
    }

    /// 按订单快照开通 / 续订订阅，并回写 `subscriptionID`。
    ///
    /// 与订单状态写在同一个事务里：要么「已付款 + 已开通」一起落库，要么一起回滚。
    /// 唯一例外是开通失败后只留 `remark`（订单保持 `PAID` + 空 `subscriptionID`），
    /// 下次查单会重新走到这里补齐。
    async fn activate(
        scope: &TenantScope,
        config: &Configure,
        redis: &RedisPool,
        order: payment_order::Model,
        transaction_id: Option<String>,
    ) -> Result<OrderR, PaymentError> {
        if order.subscription_id.is_some() {
            return Ok(to_r(order, config));
        }

        // 续费不浪费剩余时长：生效订阅未到期时从其到期时间续期（同一事务内读，与写入共用一个连接）
        let base = SubscriptionService::active_subscription_in(scope.tx())
            .await
            .map_err(db_err)?
            .and_then(|active| active.expires_at)
            .filter(|end| *end > Utc::now().fixed_offset())
            .unwrap_or_else(|| Utc::now().fixed_offset());
        let expires_at = order
            .duration_days
            .map(|days| (base + Duration::days(days as i64)).timestamp_millis());

        // 订阅写入走同一个租户作用域（机器路径：验签与金额核对都已在本函数之前完成）
        let granted = SubscriptionService::grant(
            scope,
            config,
            redis,
            UserId::from_uuid(order.user_id),
            SubscribeP {
                plan: order.plan.clone(),
                expires_at,
            },
        )
        .await;

        let subscription_id = match granted {
            Ok(item) => Uuid::parse_str(&item.id).ok(),
            // 并发核销下另一方已完成开通：本次不写订阅，回读生效订阅作为结果（订阅集合等价）。
            // 唯一索引已经中止了本事务，后面写什么都失败，因此直接交给持有者回滚重试。
            Err(SubscriptionError::Conflict) => {
                tracing::warn!(order_no = %order.order_no, "subscription activated concurrently");
                return Err(PaymentError::Db("订阅已被并发开通，请重试".to_string()));
            }
            Err(err) => {
                // 已收款但开通失败：保留 PAID + 空 subscriptionID，等待下次 sync 自愈或人工处理。
                // 备注必须落库，所以返回「伴随写入」的错误，让持有者提交。
                let remark = format!("已收款，开通订阅失败：{err}");
                tracing::error!(order_no = %order.order_no, error = %remark, "activate failed");
                set_remark(scope.tx(), &order, &remark).await?;
                return Err(PaymentError::ActivationFailed(err.to_string()));
            }
        };

        let late_payment = order.status == CLOSED;
        let previous_remark = order.remark.clone();
        let now = Utc::now().fixed_offset();
        let mut active: payment_order::ActiveModel = order.into();
        let previous_transaction_id = active.transaction_id.take().flatten();
        let previous_paid_at = active.paid_at.take().flatten();
        active.status = Set(PAID.to_string());
        active.transaction_id = Set(transaction_id.or(previous_transaction_id));
        active.subscription_id = Set(subscription_id);
        active.remark = Set(if late_payment {
            Some("迟到支付：订单已关闭后收到成功回调，已开通订阅".to_string())
        } else {
            previous_remark
        });
        active.paid_at = Set(previous_paid_at.or(Some(now)));
        active.updated_at = Set(now);
        let saved = active.update(scope.tx()).await.map_err(db_err)?;

        // 订阅变更后立刻失效档位缓存，避免「已付款但配额仍是免费档」的观感问题
        cache_invalidate(redis, saved.tenant_id).await;
        Ok(to_r(saved, config))
    }
}

/// 展示用套餐名：`Cogito <档位> <时长>` / 永久。
fn subject_of(config: &Configure, order: &payment_order::Model) -> String {
    let label = config
        .pay_plan(&order.plan)
        .and_then(|spec| spec.label.clone())
        .unwrap_or_else(|| order.plan.clone());
    match order.duration_days {
        Some(days) => format!("Cogito {label} {days} 天"),
        None => format!("Cogito {label} 永久"),
    }
}

/// 平台订单号：`P` + 秒级 UTC 时间戳 + 随机段，仅字母数字（微信 `out_trade_no` 约束）。
fn order_no() -> String {
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let mut random = String::with_capacity(ORDER_NO_RANDOM_LEN);
    for byte in Uuid::new_v4().as_bytes().iter().take(ORDER_NO_RANDOM_LEN) {
        random.push(ALPHABET[(*byte as usize) % ALPHABET.len()] as char);
    }
    format!("P{}{}", Utc::now().format("%Y%m%d%H%M%S"), random)
}

/// 按订单号取单：不带 `tenantID` 条件，租户隔离由作用域负责。
async fn load(
    tx: &DatabaseTransaction,
    order_no: &str,
) -> Result<payment_order::Model, PaymentError> {
    payment_order::Entity::find()
        .filter(payment_order::Column::OrderNo.eq(order_no))
        .filter(payment_order::Column::ArchivedAt.is_null())
        .one(tx)
        .await
        .map_err(db_err)?
        .ok_or(PaymentError::OrderNotFound)
}

/// 惰性关单：关闭**本租户**所有已过期的待支付订单。
async fn close_stale(tx: &DatabaseTransaction) -> Result<(), PaymentError> {
    let now = Utc::now().fixed_offset();
    payment_order::Entity::update_many()
        .col_expr(
            payment_order::Column::Status,
            sea_orm::sea_query::Expr::value(CLOSED),
        )
        .col_expr(
            payment_order::Column::Remark,
            sea_orm::sea_query::Expr::value("超时未支付"),
        )
        .col_expr(
            payment_order::Column::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(payment_order::Column::Status.eq(PENDING))
        .filter(payment_order::Column::ExpiresAt.lte(now))
        .filter(payment_order::Column::ArchivedAt.is_null())
        .exec(tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

async fn mark_closed(
    tx: &DatabaseTransaction,
    order: payment_order::Model,
    remark: &str,
    updater: Option<Uuid>,
) -> Result<payment_order::Model, PaymentError> {
    let now = Utc::now().fixed_offset();
    let mut active: payment_order::ActiveModel = order.into();
    active.status = Set(CLOSED.to_string());
    active.remark = Set(Some(remark.to_string()));
    active.updated_at = Set(now);
    if updater.is_some() {
        active.updater = Set(updater);
    }
    active.update(tx).await.map_err(db_err)
}

/// 只写备注，不改状态（用于「已收款但开通失败」「金额不符」这类待人工核对的情况）。
async fn set_remark(
    tx: &DatabaseTransaction,
    order: &payment_order::Model,
    remark: &str,
) -> Result<(), PaymentError> {
    payment_order::Entity::update_many()
        .col_expr(
            payment_order::Column::Remark,
            sea_orm::sea_query::Expr::value(remark),
        )
        .col_expr(
            payment_order::Column::UpdatedAt,
            sea_orm::sea_query::Expr::value(Utc::now().fixed_offset()),
        )
        .filter(payment_order::Column::Id.eq(order.id))
        .exec(tx)
        .await
        .map_err(db_err)?;
    Ok(())
}

fn to_r(order: payment_order::Model, config: &Configure) -> OrderR {
    OrderR {
        order_no: order.order_no,
        tenant_id: order.tenant_id.to_string(),
        plan: order.plan.clone(),
        channel: order.channel,
        amount: order.amount,
        currency: order.currency,
        status: order.status,
        code_url: order.code_url,
        transaction_id: order.transaction_id,
        subscription_id: order.subscription_id.map(|id| id.to_string()),
        daily_token_quota: config
            .gateway_plan_daily_token_quota(&order.plan)
            .unwrap_or(0),
        duration_days: order.duration_days,
        created_at: order.created_at.timestamp_millis(),
        order_expires_at: order.expires_at.timestamp_millis(),
        paid_at: order.paid_at.map(|at| at.timestamp_millis()),
        remark: order.remark,
    }
}

/// 充值只对个人租户开放：团队租户的配额由平台统一分配。
async fn require_personal(
    tx: &DatabaseTransaction,
    tenant_id: TenantId,
) -> Result<(), PaymentError> {
    let tenant = tenant::Entity::find_by_id(tenant_id.as_uuid())
        .one(tx)
        .await
        .map_err(db_err)?
        .ok_or(PaymentError::TenantNotFound)?;
    if TenantType::is_personal(&tenant.tenant_type) {
        Ok(())
    } else {
        Err(PaymentError::NotPersonal)
    }
}

/// 档位不可售的原因（`None` = 可售）。
///
/// 定价与配额两条硬条件：`amount <= 0` 视为未定价（不可售），缺 `gateway.plan_daily_token_quota`
/// 会导致开通后无法计费。目录与下单共用同一判断，界面上的置灰理由和后端的拒绝理由永远一致。
fn unsellable_reason(config: &Configure, plan: &str, spec: &PayPlanConfig) -> Option<String> {
    if spec.amount <= 0 {
        return Some("档位未定价，暂不可购买".to_string());
    }
    if config.gateway_plan_daily_token_quota(plan).is_none() {
        return Some("档位缺少日配额配置，暂不可购买".to_string());
    }
    None
}

fn db_err(err: DbErr) -> PaymentError {
    PaymentError::Db(err.to_string())
}

fn scope_err(err: Exception) -> PaymentError {
    PaymentError::Db(err.msg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_no_is_alphanumeric_and_within_upstream_limit() {
        let first = order_no();
        assert!(first.starts_with('P'));
        assert!(first.len() >= 6 && first.len() <= 32, "len={}", first.len());
        assert!(first.chars().all(|ch| ch.is_ascii_alphanumeric()));
        assert_ne!(first, order_no());
    }

    #[test]
    fn amount_mismatch_maps_to_business_code() {
        let exception = Exception::from(PaymentError::AmountMismatch);
        assert_eq!(exception.code, business::payment::AMOUNT_MISMATCH);
    }

    #[test]
    fn channel_errors_map_to_expected_codes() {
        let unavailable = Exception::from(PaymentError::from(ChannelError::Unavailable(
            "渠道未开通".to_string(),
        )));
        assert_eq!(unavailable.code, business::payment::CHANNEL_UNAVAILABLE);
        let signature = Exception::from(PaymentError::from(ChannelError::Signature(
            "回调签名校验失败".to_string(),
        )));
        assert_eq!(signature.code, business::payment::SIGNATURE_INVALID);
    }

    /// 包一层的「下单失败已关单」不改状态码与文案，只改「有没有写入要保留」。
    #[test]
    fn closed_by_failure_keeps_the_original_mapping_and_the_writes() {
        let plain = Exception::from(PaymentError::BadParam("响应无法解析".to_string()));
        let wrapped = Exception::from(PaymentError::ClosedByFailure(Box::new(
            PaymentError::BadParam("响应无法解析".to_string()),
        )));
        assert_eq!(plain.code, wrapped.code);
        assert_eq!(plain.msg, wrapped.msg);
        assert!(!PaymentError::BadParam("响应无法解析".to_string()).keeps_writes());
        assert!(
            PaymentError::ClosedByFailure(Box::new(PaymentError::BadParam(
                "响应无法解析".to_string()
            )))
            .keeps_writes()
        );
    }

    /// 事务收尾的依据：动过账的错误必须提交，没动过账（或事务已中止）的错误回滚。
    #[test]
    fn only_errors_that_carry_writes_ask_for_a_commit() {
        for err in [
            PaymentError::AmountMismatch,
            PaymentError::OrderExpired,
            PaymentError::OrderClosed,
            PaymentError::ActivationFailed("订阅写入失败".to_string()),
            PaymentError::ClosedByFailure(Box::new(PaymentError::Upstream("渠道 500".to_string()))),
        ] {
            assert!(err.keeps_writes(), "{err} 伴随写入，必须提交");
        }

        for err in [
            PaymentError::Forbidden,
            PaymentError::OrderNotFound,
            PaymentError::Signature("验签失败".to_string()),
            PaymentError::Upstream("渠道 500".to_string()),
            PaymentError::Db("事务已中止".to_string()),
        ] {
            assert!(!err.keeps_writes(), "{err} 没有写入，应当回滚");
        }
    }

    #[test]
    fn a_plan_needs_a_price_and_a_quota_to_be_sellable() {
        let spec = PayPlanConfig {
            amount: 1990,
            duration_days: Some(30),
            label: None,
        };
        let mut config = Configure::default();

        // 缺日配额：开通后无法计费
        assert_eq!(
            unsellable_reason(&config, "pro", &spec).as_deref(),
            Some("档位缺少日配额配置，暂不可购买")
        );

        config
            .gateway
            .plan_daily_token_quota
            .insert("pro".to_string(), 5_000_000);
        assert!(unsellable_reason(&config, "pro", &spec).is_none());

        // 未定价（amount <= 0）：收银台不能卖
        let free = PayPlanConfig {
            amount: 0,
            duration_days: Some(30),
            label: None,
        };
        assert_eq!(
            unsellable_reason(&config, "pro", &free).as_deref(),
            Some("档位未定价，暂不可购买")
        );
    }
}
