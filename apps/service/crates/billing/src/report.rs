//! 对账：把「用量折算出的金额」和「订单实收」摆到同一张表上，并把说不清的部分显式列成异常。
//!
//! 这里是纯函数，输入是已经聚合好的分组（聚合 SQL 在 service 层，见 README「对外接口」），
//! 所以整条口径都可以用单测钉住：
//!
//! - 只有 `status = 'OK'` 的用量进账；失败用量单独计数，不进金额。
//! - 每个分组各自舍入到整分（见 `money::amount_cents`），再按租户汇总。
//! - 币种与结算币种不一致的分组**不并入合计**，单独记在 `mismatched_amount` 里，
//!   这样 `usage_amount + mismatched_amount` 恒等于型号明细金额之和，可断言。
//! - 全局合计由「每个租户的合计」相加得到，不会和明细漂移。

use std::collections::BTreeMap;

use uuid::Uuid;

use crate::money::{MoneyError, amount_cents};

/// 一处用量分组：同一租户 × 同一型号 × 同一价目，已在 SQL 里聚合过。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageGroup {
    /// `None` = 用量没有归属租户（`gateway_usage.tenantID` 可空）。
    pub tenant_id: Option<Uuid>,
    pub model_id: Uuid,
    /// 由服务层的对账 SQL `LEFT JOIN gateway_model` 补齐；内核不查库。
    pub model_name: Option<String>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub requests: i64,
    /// `None` = 该时间点没有任何价目命中，即「未定价用量」。
    pub price: Option<AppliedPrice>,
}

/// 命中并生效的那条价目（快照，用于复算）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedPrice {
    pub id: Uuid,
    pub currency: String,
    pub input_per_million: i64,
    pub output_per_million: i64,
}

/// 窗口内同一租户已支付订单的合计。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderGroup {
    pub tenant_id: Uuid,
    pub currency: String,
    pub amount: i64,
    pub orders: i64,
}

/// 窗口内未计入的用量（`status != 'OK'`）：只报数量，不报金额。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FailedGroup {
    pub tenant_id: Option<Uuid>,
    pub status: String,
    pub requests: i64,
}

/// 需要在报告里点名的订单。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderRef {
    pub order_no: String,
    pub tenant_id: Uuid,
    pub amount: i64,
    pub detail: Option<String>,
}

/// 一次对账的全部输入。时间窗口是左闭右开 `[from, to)`，单位毫秒。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReconcileInput {
    pub from_millis: i64,
    pub to_millis: i64,
    /// 结算币种（来自订单配置）：价格与订单都要跟它对齐才进合计。
    pub currency: String,
    pub usage: Vec<UsageGroup>,
    pub failed: Vec<FailedGroup>,
    pub orders: Vec<OrderGroup>,
    /// 已收款但没开通订阅（`PAID` 且 `subscriptionID` 为空）。
    pub unactivated: Vec<OrderRef>,
    /// 备注非空的订单，通常是人工介入的痕迹。
    pub remarked: Vec<OrderRef>,
}

/// 异常类型。`as_str` 同时用于 JSON 与 CSV 的 `kind` 列。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ExceptionKind {
    PaidNotActivated,
    Remarked,
    UsageWithoutOrder,
    OrderWithoutUsage,
    UnpricedUsage,
    CurrencyMismatch,
}

impl ExceptionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PaidNotActivated => "PAID_NOT_ACTIVATED",
            Self::Remarked => "REMARKED",
            Self::UsageWithoutOrder => "USAGE_WITHOUT_ORDER",
            Self::OrderWithoutUsage => "ORDER_WITHOUT_USAGE",
            Self::UnpricedUsage => "UNPRICED_USAGE",
            Self::CurrencyMismatch => "CURRENCY_MISMATCH",
        }
    }

    pub fn description(self) -> &'static str {
        match self {
            Self::PaidNotActivated => "已收款但未开通订阅",
            Self::Remarked => "订单备注非空，可能经过人工处理",
            Self::UsageWithoutOrder => "有用量但没有已支付订单",
            Self::OrderWithoutUsage => "有已支付订单但没有用量",
            Self::UnpricedUsage => "用量没有匹配到价目，金额未计入合计",
            Self::CurrencyMismatch => "币种与结算币种不一致，金额未计入合计",
        }
    }
}

/// 一条要在报告里点名的异常。字段顺序即排序顺序，保证同一份输入永远输出同样的次序。
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ReconcileException {
    pub kind: ExceptionKind,
    pub tenant_id: Option<Uuid>,
    pub model_id: Option<Uuid>,
    pub order_no: Option<String>,
    /// 该异常涉及的金额（分）；未定价与纯计数类异常为 `None`。
    pub amount: Option<i64>,
    pub detail: String,
}

/// 合计。`delta` 由 `seal()` 在最后统一算出，避免边累加边算导致中间态被误读。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Totals {
    /// 用量折算金额（分），只含结算币种。
    pub usage_amount: i64,
    /// 订单实收（分），只含结算币种。
    pub order_amount: i64,
    /// `usage_amount - order_amount`：正数 = 用了没付，负数 = 付了没用。
    pub delta: i64,
    pub usage_requests: i64,
    pub unpriced_requests: i64,
    pub failed_requests: i64,
    /// 被排除在 `usage_amount` 之外的用量金额，仅币种不一致造成。
    pub mismatched_amount: i64,
    /// 被排除在 `order_amount` 之外的订单金额，仅币种不一致造成。
    pub mismatched_order_amount: i64,
    pub paid_orders: i64,
}

impl Totals {
    fn add(&mut self, other: &Self) -> Result<(), ReconcileError> {
        self.usage_amount = checked_add(self.usage_amount, other.usage_amount)?;
        self.order_amount = checked_add(self.order_amount, other.order_amount)?;
        self.usage_requests = checked_add(self.usage_requests, other.usage_requests)?;
        self.unpriced_requests = checked_add(self.unpriced_requests, other.unpriced_requests)?;
        self.failed_requests = checked_add(self.failed_requests, other.failed_requests)?;
        self.mismatched_amount = checked_add(self.mismatched_amount, other.mismatched_amount)?;
        self.mismatched_order_amount =
            checked_add(self.mismatched_order_amount, other.mismatched_order_amount)?;
        self.paid_orders = checked_add(self.paid_orders, other.paid_orders)?;
        Ok(())
    }

    fn seal(&mut self) -> Result<(), ReconcileError> {
        self.delta = self
            .usage_amount
            .checked_sub(self.order_amount)
            .ok_or(ReconcileError::Overflow)?;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TenantReconciliation {
    pub tenant_id: Option<Uuid>,
    pub totals: Totals,
}

/// 型号明细：任何一行都能用「token 数 × 单价」独立复算。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelReconciliation {
    pub tenant_id: Option<Uuid>,
    pub model_id: Uuid,
    pub model_name: Option<String>,
    pub price_id: Option<Uuid>,
    pub currency: Option<String>,
    pub input_per_million: Option<i64>,
    pub output_per_million: Option<i64>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub requests: i64,
    /// `None` = 未定价；此时租户合计只是「下限」。
    pub amount: Option<i64>,
    pub mismatched_currency: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reconciliation {
    pub from_millis: i64,
    pub to_millis: i64,
    pub currency: String,
    pub totals: Totals,
    pub tenants: Vec<TenantReconciliation>,
    pub models: Vec<ModelReconciliation>,
    pub exceptions: Vec<ReconcileException>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReconcileError {
    #[error(transparent)]
    Money(#[from] MoneyError),
    #[error("对账合计超出 64 位整数范围")]
    Overflow,
}

fn checked_add(current: i64, delta: i64) -> Result<i64, ReconcileError> {
    current.checked_add(delta).ok_or(ReconcileError::Overflow)
}

/// 装配一份对账报告。
pub fn reconcile(input: ReconcileInput) -> Result<Reconciliation, ReconcileError> {
    let ReconcileInput {
        from_millis,
        to_millis,
        currency,
        usage,
        failed,
        orders,
        unactivated,
        remarked,
    } = input;

    let mut tenants: BTreeMap<Option<Uuid>, Totals> = BTreeMap::new();
    let mut models = Vec::with_capacity(usage.len());
    let mut exceptions = Vec::new();

    for group in usage {
        let amount = match &group.price {
            Some(price) => Some(amount_cents(
                group.prompt_tokens,
                group.completion_tokens,
                price.input_per_million,
                price.output_per_million,
            )?),
            None => None,
        };
        let mismatched_currency = group
            .price
            .as_ref()
            .is_some_and(|price| price.currency != currency);

        {
            let totals = tenants.entry(group.tenant_id).or_default();
            totals.usage_requests = checked_add(totals.usage_requests, group.requests)?;
            match (amount, mismatched_currency) {
                (Some(amount), false) => {
                    totals.usage_amount = checked_add(totals.usage_amount, amount)?;
                }
                (Some(amount), true) => {
                    totals.mismatched_amount = checked_add(totals.mismatched_amount, amount)?;
                }
                (None, _) => {
                    totals.unpriced_requests =
                        checked_add(totals.unpriced_requests, group.requests)?;
                }
            }
        }

        if amount.is_none() {
            exceptions.push(ReconcileException {
                kind: ExceptionKind::UnpricedUsage,
                tenant_id: group.tenant_id,
                model_id: Some(group.model_id),
                order_no: None,
                amount: None,
                detail: format!("{} 次请求没有匹配到价目", group.requests),
            });
        }
        if mismatched_currency {
            let price_currency = group
                .price
                .as_ref()
                .map(|price| price.currency.as_str())
                .unwrap_or_default();
            exceptions.push(ReconcileException {
                kind: ExceptionKind::CurrencyMismatch,
                tenant_id: group.tenant_id,
                model_id: Some(group.model_id),
                order_no: None,
                amount,
                detail: format!("价目币种 {price_currency}，与结算币种 {currency} 不一致"),
            });
        }

        models.push(ModelReconciliation {
            tenant_id: group.tenant_id,
            model_id: group.model_id,
            model_name: group.model_name,
            price_id: group.price.as_ref().map(|price| price.id),
            currency: group.price.as_ref().map(|price| price.currency.clone()),
            input_per_million: group.price.as_ref().map(|price| price.input_per_million),
            output_per_million: group.price.as_ref().map(|price| price.output_per_million),
            prompt_tokens: group.prompt_tokens,
            completion_tokens: group.completion_tokens,
            requests: group.requests,
            amount,
            mismatched_currency,
        });
    }

    for group in failed {
        let totals = tenants.entry(group.tenant_id).or_default();
        totals.failed_requests = checked_add(totals.failed_requests, group.requests)?;
    }

    for group in orders {
        let totals = tenants.entry(Some(group.tenant_id)).or_default();
        totals.paid_orders = checked_add(totals.paid_orders, group.orders)?;
        if group.currency == currency {
            totals.order_amount = checked_add(totals.order_amount, group.amount)?;
        } else {
            totals.mismatched_order_amount =
                checked_add(totals.mismatched_order_amount, group.amount)?;
            exceptions.push(ReconcileException {
                kind: ExceptionKind::CurrencyMismatch,
                tenant_id: Some(group.tenant_id),
                model_id: None,
                order_no: None,
                amount: Some(group.amount),
                detail: format!("订单币种 {}，与结算币种 {currency} 不一致", group.currency),
            });
        }
    }

    let mut tenant_rows = Vec::with_capacity(tenants.len());
    for (tenant_id, mut totals) in tenants {
        totals.seal()?;
        if totals.paid_orders > 0 && totals.usage_requests == 0 {
            exceptions.push(ReconcileException {
                kind: ExceptionKind::OrderWithoutUsage,
                tenant_id,
                model_id: None,
                order_no: None,
                amount: Some(totals.order_amount),
                detail: format!("{} 笔已支付订单没有任何用量", totals.paid_orders),
            });
        }
        if totals.usage_requests > 0 && totals.paid_orders == 0 {
            exceptions.push(ReconcileException {
                kind: ExceptionKind::UsageWithoutOrder,
                tenant_id,
                model_id: None,
                order_no: None,
                amount: Some(totals.usage_amount),
                detail: format!("{} 次请求没有对应的已支付订单", totals.usage_requests),
            });
        }
        tenant_rows.push(TenantReconciliation { tenant_id, totals });
    }

    // 全局合计由每租户合计相加得出，杜绝「总账与明细不一致」
    let mut totals = Totals::default();
    for row in &tenant_rows {
        totals.add(&row.totals)?;
    }
    totals.seal()?;

    for order in unactivated {
        exceptions.push(ReconcileException {
            kind: ExceptionKind::PaidNotActivated,
            tenant_id: Some(order.tenant_id),
            model_id: None,
            order_no: Some(order.order_no),
            amount: Some(order.amount),
            detail: order
                .detail
                .unwrap_or_else(|| ExceptionKind::PaidNotActivated.description().to_string()),
        });
    }

    for order in remarked {
        exceptions.push(ReconcileException {
            kind: ExceptionKind::Remarked,
            tenant_id: Some(order.tenant_id),
            model_id: None,
            order_no: Some(order.order_no),
            amount: Some(order.amount),
            detail: order
                .detail
                .unwrap_or_else(|| ExceptionKind::Remarked.description().to_string()),
        });
    }

    models.sort_by_key(|model| (model.tenant_id, model.model_id));
    exceptions.sort();

    Ok(Reconciliation {
        from_millis,
        to_millis,
        currency,
        totals,
        tenants: tenant_rows,
        models,
        exceptions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn uid(byte: u8) -> Uuid {
        Uuid::from_bytes([byte; 16])
    }

    fn price(currency: &str, input_per_million: i64, output_per_million: i64) -> AppliedPrice {
        AppliedPrice {
            id: uid(200),
            currency: currency.to_string(),
            input_per_million,
            output_per_million,
        }
    }

    fn usage(
        tenant_id: Option<Uuid>,
        model: u8,
        prompt: i64,
        requests: i64,
        price: Option<AppliedPrice>,
    ) -> UsageGroup {
        UsageGroup {
            tenant_id,
            model_id: uid(model),
            model_name: Some(format!("model-{model}")),
            prompt_tokens: prompt,
            completion_tokens: 0,
            requests,
            price,
        }
    }

    fn input(usage: Vec<UsageGroup>) -> ReconcileInput {
        ReconcileInput {
            from_millis: 0,
            to_millis: 86_400_000,
            currency: "CNY".to_string(),
            usage,
            failed: Vec::new(),
            orders: Vec::new(),
            unactivated: Vec::new(),
            remarked: Vec::new(),
        }
    }

    /// `usage_amount + mismatched_amount` 必须等于型号明细里所有已知金额之和。
    fn assert_amount_invariant(report: &Reconciliation) {
        let sum: i64 = report.models.iter().filter_map(|model| model.amount).sum();
        assert_eq!(
            report.totals.usage_amount + report.totals.mismatched_amount,
            sum
        );
    }

    fn kinds(report: &Reconciliation) -> Vec<ExceptionKind> {
        report.exceptions.iter().map(|e| e.kind).collect()
    }

    #[test]
    fn usage_matching_paid_orders_balances_to_zero() {
        let tenant = uid(1);
        let mut input = input(vec![usage(
            Some(tenant),
            2,
            1_000_000,
            3,
            Some(price("CNY", 100, 400)),
        )]);
        input.orders.push(OrderGroup {
            tenant_id: tenant,
            currency: "CNY".to_string(),
            amount: 100,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.usage_amount, 100);
        assert_eq!(report.totals.order_amount, 100);
        assert_eq!(report.totals.delta, 0);
        assert_eq!(report.totals.usage_requests, 3);
        assert_eq!(report.totals.paid_orders, 1);
        assert!(report.exceptions.is_empty(), "{:?}", report.exceptions);
        assert_eq!(report.models.len(), 1);
        assert_eq!(report.models[0].amount, Some(100));
        assert_eq!(report.models[0].price_id, Some(uid(200)));
        assert_eq!(report.tenants.len(), 1);
        assert_eq!(report.tenants[0].tenant_id, Some(tenant));
        assert_amount_invariant(&report);
    }

    #[test]
    fn unpriced_usage_makes_the_total_a_lower_bound() {
        let tenant = uid(1);
        let mut input = input(vec![
            usage(Some(tenant), 2, 1_000_000, 3, Some(price("CNY", 100, 400))),
            usage(Some(tenant), 3, 2_000_000, 5, None),
        ]);
        input.orders.push(OrderGroup {
            tenant_id: tenant,
            currency: "CNY".to_string(),
            amount: 100,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.usage_amount, 100);
        assert_eq!(report.totals.unpriced_requests, 5);
        assert_eq!(report.models[1].amount, None);
        assert_eq!(report.models[1].requests, 5);
        assert_eq!(kinds(&report), vec![ExceptionKind::UnpricedUsage]);
        assert_amount_invariant(&report);
    }

    #[test]
    fn foreign_currency_groups_are_reported_but_not_summed() {
        let tenant = uid(1);
        let mut input = input(vec![usage(
            Some(tenant),
            2,
            1_000_000,
            1,
            Some(price("USD", 100, 400)),
        )]);
        input.orders.push(OrderGroup {
            tenant_id: tenant,
            currency: "CNY".to_string(),
            amount: 100,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.usage_amount, 0);
        assert_eq!(report.totals.mismatched_amount, 100);
        assert_eq!(report.totals.order_amount, 100);
        assert!(report.models[0].mismatched_currency);
        assert_eq!(report.models[0].amount, Some(100));
        assert!(kinds(&report).contains(&ExceptionKind::CurrencyMismatch));
        assert_amount_invariant(&report);
    }

    #[test]
    fn mismatched_order_currency_is_excluded_from_received_amount() {
        let tenant = uid(1);
        let mut input = input(vec![usage(
            Some(tenant),
            2,
            1_000_000,
            1,
            Some(price("CNY", 100, 400)),
        )]);
        input.orders.push(OrderGroup {
            tenant_id: tenant,
            currency: "USD".to_string(),
            amount: 700,
            orders: 2,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.order_amount, 0);
        assert_eq!(report.totals.mismatched_order_amount, 700);
        assert_eq!(report.totals.paid_orders, 2);
        let mismatch = report
            .exceptions
            .iter()
            .find(|e| e.kind == ExceptionKind::CurrencyMismatch)
            .expect("currency mismatch");
        assert_eq!(mismatch.amount, Some(700));
        // 订单不计入实收 → 该租户依然「用了没付」
        assert_eq!(report.totals.delta, 100);
    }

    #[test]
    fn usage_without_order_and_order_without_usage_are_both_named() {
        let tenant_with_usage = uid(1);
        let tenant_with_order = uid(2);
        let mut input = input(vec![usage(
            Some(tenant_with_usage),
            2,
            1_000_000,
            4,
            Some(price("CNY", 100, 400)),
        )]);
        input.orders.push(OrderGroup {
            tenant_id: tenant_with_order,
            currency: "CNY".to_string(),
            amount: 500,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.tenants.len(), 2);
        let usage_side = report
            .exceptions
            .iter()
            .find(|e| e.kind == ExceptionKind::UsageWithoutOrder)
            .expect("usage without order");
        assert_eq!(usage_side.tenant_id, Some(tenant_with_usage));
        assert_eq!(usage_side.amount, Some(100));
        let order_side = report
            .exceptions
            .iter()
            .find(|e| e.kind == ExceptionKind::OrderWithoutUsage)
            .expect("order without usage");
        assert_eq!(order_side.tenant_id, Some(tenant_with_order));
        assert_eq!(order_side.amount, Some(500));
        assert_eq!(report.totals.delta, 100 - 500);
    }

    #[test]
    fn failed_usage_is_counted_but_never_charged() {
        let tenant = uid(1);
        let mut input = input(vec![usage(
            Some(tenant),
            2,
            1_000_000,
            1,
            Some(price("CNY", 100, 400)),
        )]);
        input.failed.push(FailedGroup {
            tenant_id: Some(tenant),
            status: "QUOTA".to_string(),
            requests: 7,
        });
        input.orders.push(OrderGroup {
            tenant_id: tenant,
            currency: "CNY".to_string(),
            amount: 100,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.failed_requests, 7);
        assert_eq!(report.totals.usage_amount, 100);
        assert_eq!(report.totals.delta, 0);
    }

    #[test]
    fn orders_needing_attention_are_listed_by_order_no() {
        let tenant = uid(1);
        let mut input = input(Vec::new());
        input.unactivated.push(OrderRef {
            order_no: "O-2".to_string(),
            tenant_id: tenant,
            amount: 900,
            detail: None,
        });
        input.remarked.push(OrderRef {
            order_no: "O-1".to_string(),
            tenant_id: tenant,
            amount: 100,
            detail: Some("客户要求改期".to_string()),
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(
            kinds(&report),
            vec![ExceptionKind::PaidNotActivated, ExceptionKind::Remarked]
        );
        assert_eq!(report.exceptions[0].order_no, Some("O-2".to_string()));
        assert_eq!(
            report.exceptions[0].detail,
            ExceptionKind::PaidNotActivated.description()
        );
        assert_eq!(report.exceptions[1].detail, "客户要求改期");
    }

    #[test]
    fn global_totals_are_the_sum_of_tenant_totals() {
        let mut input = input(vec![
            usage(Some(uid(1)), 2, 1_000_000, 1, Some(price("CNY", 100, 400))),
            usage(Some(uid(2)), 3, 2_000_000, 2, Some(price("CNY", 100, 400))),
            usage(None, 4, 500_000, 3, None),
        ]);
        input.failed.push(FailedGroup {
            tenant_id: Some(uid(2)),
            status: "ERROR".to_string(),
            requests: 2,
        });
        input.orders.push(OrderGroup {
            tenant_id: uid(1),
            currency: "CNY".to_string(),
            amount: 100,
            orders: 1,
        });
        input.orders.push(OrderGroup {
            tenant_id: uid(2),
            currency: "CNY".to_string(),
            amount: 400,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        let mut summed = Totals::default();
        for row in &report.tenants {
            summed.add(&row.totals).expect("sum");
        }
        summed.seal().expect("seal");

        assert_eq!(report.totals, summed);
        assert_eq!(report.totals.usage_amount, 100 + 200);
        assert_eq!(report.totals.order_amount, 100 + 400);
        assert_eq!(report.totals.delta, -200);
        assert_eq!(report.totals.unpriced_requests, 3);
        assert_eq!(report.totals.failed_requests, 2);
        assert_amount_invariant(&report);
    }

    #[test]
    fn rounding_stays_per_group() {
        // 每个型号各自 0.5 分，两次进位；先求和再舍入只会得到 1 分
        let mut input = input(vec![
            usage(Some(uid(1)), 2, 500_000, 1, Some(price("CNY", 1, 0))),
            usage(Some(uid(1)), 3, 500_000, 1, Some(price("CNY", 1, 0))),
        ]);
        input.orders.push(OrderGroup {
            tenant_id: uid(1),
            currency: "CNY".to_string(),
            amount: 2,
            orders: 1,
        });

        let report = reconcile(input).expect("reconcile");

        assert_eq!(report.totals.usage_amount, 2);
        assert_eq!(report.totals.delta, 0);
        assert_eq!(
            report.models.iter().map(|m| m.amount).collect::<Vec<_>>(),
            vec![Some(1), Some(1)]
        );
    }

    #[test]
    fn absurd_token_counts_surface_as_money_errors() {
        let input = input(vec![usage(
            Some(uid(1)),
            2,
            -1,
            1,
            Some(price("CNY", 100, 400)),
        )]);
        assert_eq!(
            reconcile(input),
            Err(ReconcileError::Money(MoneyError::Negative))
        );
    }

    #[test]
    fn exceptions_are_ordered_deterministically() {
        let mut input = input(vec![
            usage(Some(uid(2)), 3, 1_000_000, 1, None),
            usage(Some(uid(1)), 2, 1_000_000, 1, None),
        ]);
        input.unactivated.push(OrderRef {
            order_no: "O-1".to_string(),
            tenant_id: uid(1),
            amount: 10,
            detail: None,
        });

        let report = reconcile(input).expect("reconcile");

        let mut sorted = report.exceptions.clone();
        sorted.sort();
        assert_eq!(report.exceptions, sorted);
        // 先按异常类型分组，同类型内按租户升序：同一份输入永远得到同样的次序
        assert_eq!(
            report.exceptions.first().map(|e| e.kind),
            Some(ExceptionKind::PaidNotActivated)
        );
        assert_eq!(
            report.exceptions.last().map(|e| e.kind),
            Some(ExceptionKind::UnpricedUsage)
        );
        assert_eq!(
            report.exceptions.last().and_then(|e| e.tenant_id),
            Some(uid(2))
        );
    }
}
