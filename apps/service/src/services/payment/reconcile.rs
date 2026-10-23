//! 计量对账：把「用量折算出的金额」和「订单实收」摆到同一个时间窗口里比。
//!
//! 这里只做三件事：把窗口条件解析成可校验的 [`ReconcileFilter`]、用聚合 SQL 把分组
//! 捞出来、把结果交给 `billing::reconcile` 算账并映射成响应。**算账口径一行都不在本模块**
//! （公式、舍入、异常判定都在 `crates/billing`），所以对账可以脱离数据库被单测钉住；
//! 本模块要保证的是「SQL 取出来的分组和内核期待的形状一致」。
//!
//! 取价的时点语义是这套账的命门：一条用量记录必须按**它自己发生的时刻**去命中价目，
//! 而不是按「查询此刻」的价。因此取价在 SQL 里用 `LEFT JOIN LATERAL` 带上
//! `bp."effectiveFrom" <= u."createdAt" < bp."effectiveTo"` 逐行匹配，同一时刻命中多行
//! 时**租户专属价优先**（`ORDER BY (tenantID IS NULL)` 把专属价排在前面）。
//! 匹配不到就是未定价用量——它会显式出现在异常列表里，绝不静默按 0 计价。
//!
//! 窗口一律**左闭右开** `[from, to)`，单位毫秒，与审计导出同一套约定。

use chrono::{DateTime, Duration, FixedOffset, Utc};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbErr, Statement};
use uuid::Uuid;

use billing::{
    AppliedPrice, FailedGroup, OrderGroup, OrderRef, ReconcileInput, Reconciliation, UsageGroup,
    reconcile,
};

use crate::filters::exception::Exception;
use crate::guards::platform::PlatformScope;
use crate::services::payment::schema::{
    ReconcileExceptionR, ReconcileModelR, ReconcileQueryP, ReconcileR, ReconcileTenantR,
    ReconcileTotalsR,
};
use crate::utils::code::{business, external, request};

/// 缺省窗口：终点往前 24 小时。对账是日常巡检动作，默认给「昨天到现在」最顺手。
const DEFAULT_WINDOW_HOURS: i64 = 24;

/// 窗口跨度上限（天）。窗口越大，聚合 SQL 扫的行越多；按月对账足够，再大就该走归档。
const MAX_WINDOW_DAYS: i64 = 31;

/// 「备注非空」订单的取样上限：这类订单是人工痕迹，看最新的一批就够。
const REMARKED_LIMIT: u64 = 500;

#[derive(Debug, thiserror::Error)]
pub enum ReconcileError {
    #[error("对账窗口无效：{0}")]
    WindowInvalid(String),
    #[error("参数无效：{0}")]
    BadParam(String),
    #[error("数据库错误：{0}")]
    Db(String),
    #[error(transparent)]
    Kernel(#[from] billing::ReconcileError),
}

impl From<DbErr> for ReconcileError {
    fn from(err: DbErr) -> Self {
        Self::Db(err.to_string())
    }
}

impl From<ReconcileError> for Exception {
    fn from(err: ReconcileError) -> Self {
        match err {
            ReconcileError::WindowInvalid(msg) => {
                Exception::custom(business::payment::RECONCILE_WINDOW_INVALID, msg)
            }
            ReconcileError::BadParam(msg) => {
                Exception::custom(request::INVALID_PARAMETER_VALUE, msg)
            }
            ReconcileError::Kernel(err) => {
                tracing::error!(error = %err, "对账合计溢出");
                Exception::custom(
                    business::payment::RECONCILE_AMOUNT_OVERFLOW,
                    "对账合计超出可表示范围，请缩小时间窗口",
                )
            }
            ReconcileError::Db(msg) => {
                tracing::error!(error = %msg, "对账数据库错误");
                Exception::custom(external::DATABASE_ERROR, "数据库错误")
            }
        }
    }
}

/// 已校验的对账窗口。租户为 `None` = 全平台汇总。
#[derive(Debug, Clone)]
pub struct ReconcileFilter {
    pub from_millis: i64,
    pub to_millis: i64,
    pub tenant_id: Option<Uuid>,
    pub currency: String,
}

impl ReconcileFilter {
    /// 解析窗口条件；缺省是「最近 24 小时 / 全平台 / 结算币种」。
    ///
    /// 这里对参数**严格**校验（与价目列表的宽容查询有意不同）：对账结果是要拿去核账的，
    /// 「条件写错了却看起来算出了结果」比多一次报错危险得多。
    ///
    /// # Errors
    /// 起点不早于终点、跨度超过上限、时间戳非法、租户 id 或币种非法时返回相应错误。
    pub fn parse(query: &ReconcileQueryP, default_currency: &str) -> Result<Self, ReconcileError> {
        let to_millis = match query.to {
            Some(millis) => to_utc(millis, "to")?.timestamp_millis(),
            None => Utc::now().timestamp_millis(),
        };
        let from_millis = match query.from {
            Some(millis) => to_utc(millis, "from")?.timestamp_millis(),
            None => to_millis - Duration::hours(DEFAULT_WINDOW_HOURS).num_milliseconds(),
        };
        if from_millis >= to_millis {
            return Err(ReconcileError::WindowInvalid(
                "from 必须早于 to（窗口左闭右开）".to_string(),
            ));
        }
        let span = Duration::days(MAX_WINDOW_DAYS).num_milliseconds();
        if to_millis - from_millis > span {
            return Err(ReconcileError::WindowInvalid(format!(
                "窗口跨度不能超过 {MAX_WINDOW_DAYS} 天"
            )));
        }
        let tenant_id = match query.tenant_id.as_deref().map(str::trim) {
            // 空串按「没给」处理：`?tenantID=` 的语义显然不是「找一个 id 为空的行」
            None | Some("") => None,
            Some(raw) => Some(
                Uuid::parse_str(raw)
                    .map_err(|_| ReconcileError::BadParam("tenantID 格式无效".to_string()))?,
            ),
        };
        let currency = match query.currency.as_deref().map(str::trim) {
            None | Some("") => default_currency.to_string(),
            Some(raw) => raw.to_uppercase(),
        };
        Ok(Self {
            from_millis,
            to_millis,
            tenant_id,
            currency,
        })
    }

    /// 窗口起点（带时区），用于 SQL 绑定。
    fn from(&self) -> DateTime<FixedOffset> {
        to_fixed(self.from_millis)
    }

    fn to(&self) -> DateTime<FixedOffset> {
        to_fixed(self.to_millis)
    }
}

pub struct ReconcileService;

impl ReconcileService {
    /// 跑一次对账，返回内核的 [`Reconciliation`]（导出与 JSON 响应共用同一份结果）。
    ///
    /// # Errors
    /// 聚合查询失败或合计溢出。
    pub async fn report(
        scope: &PlatformScope,
        filter: &ReconcileFilter,
    ) -> Result<Reconciliation, ReconcileError> {
        let tx = scope.tx();
        let input = ReconcileInput {
            from_millis: filter.from_millis,
            to_millis: filter.to_millis,
            currency: filter.currency.clone(),
            usage: usage_groups(tx, filter).await?,
            failed: failed_groups(tx, filter).await?,
            orders: order_groups(tx, filter).await?,
            unactivated: order_refs(tx, filter, OrderRefKind::Unactivated).await?,
            remarked: order_refs(tx, filter, OrderRefKind::Remarked).await?,
        };
        Ok(reconcile(input)?)
    }
}

/// 把内核结果映射成响应体。字段一一对应，不做任何计算。
#[must_use]
pub fn to_response(report: &Reconciliation) -> ReconcileR {
    ReconcileR {
        from: report.from_millis,
        to: report.to_millis,
        currency: report.currency.clone(),
        totals: totals(&report.totals),
        tenants: report
            .tenants
            .iter()
            .map(|row| ReconcileTenantR {
                tenant_id: row.tenant_id.map(|id| id.to_string()),
                totals: totals(&row.totals),
            })
            .collect(),
        models: report
            .models
            .iter()
            .map(|row| ReconcileModelR {
                tenant_id: row.tenant_id.map(|id| id.to_string()),
                model_id: row.model_id.to_string(),
                model_name: row.model_name.clone(),
                price_id: row.price_id.map(|id| id.to_string()),
                currency: row.currency.clone(),
                input_price_per_million: row.input_per_million,
                output_price_per_million: row.output_per_million,
                prompt_tokens: row.prompt_tokens,
                completion_tokens: row.completion_tokens,
                requests: row.requests,
                amount: row.amount,
                mismatched_currency: row.mismatched_currency,
            })
            .collect(),
        exceptions: report
            .exceptions
            .iter()
            .map(|row| ReconcileExceptionR {
                kind: row.kind.as_str().to_string(),
                description: row.kind.description().to_string(),
                tenant_id: row.tenant_id.map(|id| id.to_string()),
                model_id: row.model_id.map(|id| id.to_string()),
                order_no: row.order_no.clone(),
                amount: row.amount,
                detail: row.detail.clone(),
            })
            .collect(),
    }
}

fn totals(row: &billing::Totals) -> ReconcileTotalsR {
    ReconcileTotalsR {
        usage_amount: row.usage_amount,
        order_amount: row.order_amount,
        delta: row.delta,
        usage_requests: row.usage_requests,
        unpriced_requests: row.unpriced_requests,
        failed_requests: row.failed_requests,
        mismatched_amount: row.mismatched_amount,
        mismatched_order_amount: row.mismatched_order_amount,
        paid_orders: row.paid_orders,
    }
}

/// 用量分组：按「租户 × 型号 × 命中的价目」聚合，并在同一行里挂上当时生效的单价。
///
/// 取价用 `LEFT JOIN LATERAL ... LIMIT 1` 而不是先捞出全量价目在内存里匹配：
/// 价目有生效区间，匹配规则（时间点 + 租户优先级）写在 SQL 里，内存匹配就得把同一套
/// 规则再实现一遍，两处一旦漂移，账就会对不上而没人知道。
async fn usage_groups(
    tx: &DatabaseTransaction,
    filter: &ReconcileFilter,
) -> Result<Vec<UsageGroup>, ReconcileError> {
    const SQL: &str = r#"
SELECT u."tenantID"                                            AS tenant_id,
       u."modelID"                                             AS model_id,
       p.id                                                    AS price_id,
       p.currency                                              AS price_currency,
       p."inputPricePerMillion"                                AS price_input,
       p."outputPricePerMillion"                               AS price_output,
       COALESCE(m.label, m.name)                               AS model_name,
       SUM(u."promptTokens")::bigint                           AS prompt_tokens,
       SUM(u."completionTokens")::bigint                       AS completion_tokens,
       COUNT(*)::bigint                                        AS requests
FROM gateway_usage u
LEFT JOIN gateway_model m ON m.id = u."modelID"
LEFT JOIN LATERAL (
    SELECT bp.id, bp.currency, bp."inputPricePerMillion", bp."outputPricePerMillion"
    FROM billing_price bp
    WHERE bp."modelID" = u."modelID"
      AND bp."archivedAt" IS NULL
      AND (bp."tenantID" IS NULL OR bp."tenantID" = u."tenantID")
      AND bp."effectiveFrom" <= u."createdAt"
      AND (bp."effectiveTo" IS NULL OR u."createdAt" < bp."effectiveTo")
    ORDER BY (bp."tenantID" IS NULL), bp."effectiveFrom" DESC, bp.id
    LIMIT 1
) p ON TRUE
WHERE u."status" = 'OK'
  AND u."createdAt" >= $1
  AND u."createdAt" < $2
  AND ($3::uuid IS NULL OR u."tenantID" = $3::uuid)
GROUP BY u."tenantID", u."modelID", p.id, p.currency,
         p."inputPricePerMillion", p."outputPricePerMillion", m.label, m.name
ORDER BY u."tenantID", u."modelID"
"#;
    let rows = query(tx, SQL, filter).await?;
    let mut groups = Vec::with_capacity(rows.len());
    for row in &rows {
        let price_id: Option<Uuid> = row.try_get_by_index(2)?;
        let price_currency: Option<String> = row.try_get_by_index(3)?;
        let price_input: Option<i64> = row.try_get_by_index(4)?;
        let price_output: Option<i64> = row.try_get_by_index(5)?;
        groups.push(UsageGroup {
            tenant_id: row.try_get_by_index(0)?,
            model_id: row.try_get_by_index(1)?,
            model_name: row.try_get_by_index(6)?,
            prompt_tokens: row.try_get_by_index(7)?,
            completion_tokens: row.try_get_by_index(8)?,
            requests: row.try_get_by_index(9)?,
            // 价目 id 为 null 就是没定价：三个价目列同生同灭，用 id 做判据即可
            price: price_id.map(|id| AppliedPrice {
                id,
                currency: price_currency.unwrap_or_default(),
                input_per_million: price_input.unwrap_or_default(),
                output_per_million: price_output.unwrap_or_default(),
            }),
        });
    }
    Ok(groups)
}

/// 未计入的用量：`status != 'OK'` 的请求只计数不折算金额。
///
/// 这是**有意**的口径：失败的请求没有交付，收钱没有依据；但它也不是「不用管」——
/// 全量失败说明上游有问题，所以单独统计出来给人看。
async fn failed_groups(
    tx: &DatabaseTransaction,
    filter: &ReconcileFilter,
) -> Result<Vec<FailedGroup>, ReconcileError> {
    const SQL: &str = r#"
SELECT u."tenantID"          AS tenant_id,
       u."status"            AS status,
       COUNT(*)::bigint      AS requests
FROM gateway_usage u
WHERE u."status" <> 'OK'
  AND u."createdAt" >= $1
  AND u."createdAt" < $2
  AND ($3::uuid IS NULL OR u."tenantID" = $3::uuid)
GROUP BY u."tenantID", u."status"
ORDER BY u."tenantID", u."status"
"#;
    let rows = query(tx, SQL, filter).await?;
    let mut groups = Vec::with_capacity(rows.len());
    for row in &rows {
        groups.push(FailedGroup {
            tenant_id: row.try_get_by_index(0)?,
            status: row.try_get_by_index(1)?,
            requests: row.try_get_by_index(2)?,
        });
    }
    Ok(groups)
}

/// 已支付订单合计。订单按**收款时刻**（`paidAt`，缺失时退到 `updatedAt`）落窗口：
/// 下单时间不等于到账时间，把未付款时点的单据算进收入会凭空多出一笔账。
async fn order_groups(
    tx: &DatabaseTransaction,
    filter: &ReconcileFilter,
) -> Result<Vec<OrderGroup>, ReconcileError> {
    const SQL: &str = r#"
SELECT o."tenantID"                                    AS tenant_id,
       o.currency                                      AS currency,
       SUM(o.amount)::bigint                           AS amount,
       COUNT(*)::bigint                                AS orders
FROM payment_order o
WHERE o.status = 'PAID'
  AND o."archivedAt" IS NULL
  AND COALESCE(o."paidAt", o."updatedAt") >= $1
  AND COALESCE(o."paidAt", o."updatedAt") < $2
  AND ($3::uuid IS NULL OR o."tenantID" = $3::uuid)
GROUP BY o."tenantID", o.currency
ORDER BY o."tenantID", o.currency
"#;
    let rows = query(tx, SQL, filter).await?;
    let mut groups = Vec::with_capacity(rows.len());
    for row in &rows {
        let tenant_id: Option<Uuid> = row.try_get_by_index(0)?;
        groups.push(OrderGroup {
            // 订单一定有租户；这里只是为了跟内核的 `Uuid` 对齐，缺了就当空值跳过
            tenant_id: tenant_id.unwrap_or_default(),
            currency: row.try_get_by_index(1)?,
            amount: row.try_get_by_index(2)?,
            orders: row.try_get_by_index(3)?,
        });
    }
    Ok(groups)
}

/// 需要在报告里点名的订单。
#[derive(Debug, Clone, Copy)]
enum OrderRefKind {
    /// 已收款但没开通订阅：钱到了、服务没给，必须有人看一眼。
    Unactivated,
    /// 备注非空：通常是人工介入（补单、退款说明）留下的痕迹。
    Remarked,
}

async fn order_refs(
    tx: &DatabaseTransaction,
    filter: &ReconcileFilter,
    kind: OrderRefKind,
) -> Result<Vec<OrderRef>, ReconcileError> {
    // 两种取样的窗口条件与 ORDER BY 完全一致，只有 WHERE 的差异，因此共用一份 SQL 骨架。
    let condition = match kind {
        OrderRefKind::Unactivated => r#"o."subscriptionID" IS NULL"#,
        OrderRefKind::Remarked => r#"o.remark IS NOT NULL AND btrim(o.remark) <> ''"#,
    };
    let sql = format!(
        r#"
SELECT o."orderNo"                                     AS order_no,
       o."tenantID"                                    AS tenant_id,
       o.amount                                        AS amount,
       o.remark                                        AS remark
FROM payment_order o
WHERE {condition}
  AND o."archivedAt" IS NULL
  AND COALESCE(o."paidAt", o."updatedAt") >= $1
  AND COALESCE(o."paidAt", o."updatedAt") < $2
  AND ($3::uuid IS NULL OR o."tenantID" = $3::uuid)
ORDER BY COALESCE(o."paidAt", o."updatedAt") DESC, o."orderNo"
LIMIT {REMARKED_LIMIT}
"#
    );
    let rows = query(tx, &sql, filter).await?;
    let mut refs = Vec::with_capacity(rows.len());
    for row in &rows {
        let tenant_id: Option<Uuid> = row.try_get_by_index(1)?;
        let Some(tenant_id) = tenant_id else {
            continue;
        };
        refs.push(OrderRef {
            order_no: row.try_get_by_index(0)?,
            tenant_id,
            amount: row.try_get_by_index(2)?,
            detail: row.try_get_by_index(3)?,
        });
    }
    Ok(refs)
}

/// 各条聚合查询共用的执行壳：绑定 `[from, to, tenant(null = 全平台)]` 三个参数。
async fn query(
    tx: &DatabaseTransaction,
    sql: &str,
    filter: &ReconcileFilter,
) -> Result<Vec<sea_orm::QueryResult>, ReconcileError> {
    let statement = Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        sql,
        [
            filter.from().into(),
            filter.to().into(),
            filter.tenant_id.into(),
        ],
    );
    tx.query_all_raw(statement)
        .await
        .map_err(ReconcileError::from)
}

/// 毫秒时间戳 → UTC 时刻；非法值在入口挡住，别让它流进聚合 SQL。
fn to_utc(millis: i64, field: &str) -> Result<DateTime<Utc>, ReconcileError> {
    DateTime::<Utc>::from_timestamp_millis(millis).ok_or_else(|| {
        ReconcileError::BadParam(format!("{field} 不是合法的毫秒时间戳（{millis}）"))
    })
}

fn to_fixed(millis: i64) -> DateTime<FixedOffset> {
    DateTime::<Utc>::from_timestamp_millis(millis)
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        .fixed_offset()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(
        from: Option<i64>,
        to: Option<i64>,
        tenant: Option<&str>,
        currency: Option<&str>,
    ) -> ReconcileQueryP {
        ReconcileQueryP {
            from,
            to,
            tenant_id: tenant.map(ToString::to_string),
            currency: currency.map(ToString::to_string),
        }
    }

    #[test]
    fn defaults_to_last_24_hours_in_settlement_currency() {
        let filter = ReconcileFilter::parse(&query(None, None, None, None), "CNY")
            .expect("缺省窗口必须可用");
        assert_eq!(filter.to_millis - filter.from_millis, 24 * 60 * 60 * 1000);
        assert_eq!(filter.tenant_id, None);
        assert_eq!(filter.currency, "CNY");
    }

    #[test]
    fn explicit_window_is_used_as_given() {
        let filter = ReconcileFilter::parse(&query(Some(1_000), Some(2_000), None, None), "CNY")
            .expect("合法窗口");
        assert_eq!(filter.from_millis, 1_000);
        assert_eq!(filter.to_millis, 2_000);
    }

    #[test]
    fn window_must_be_ordered_and_bounded() {
        assert!(matches!(
            ReconcileFilter::parse(&query(Some(2_000), Some(2_000), None, None), "CNY"),
            Err(ReconcileError::WindowInvalid(_))
        ));
        assert!(matches!(
            ReconcileFilter::parse(
                &query(Some(0), Some(400 * 24 * 3600 * 1000), None, None),
                "CNY"
            ),
            Err(ReconcileError::WindowInvalid(_))
        ));
    }

    #[test]
    fn blank_tenant_is_absent_and_garbage_is_rejected() {
        let filter = ReconcileFilter::parse(&query(None, None, Some("  "), None), "CNY")
            .expect("空串按没给处理");
        assert_eq!(filter.tenant_id, None);
        assert!(matches!(
            ReconcileFilter::parse(&query(None, None, Some("not-a-uuid"), None), "CNY"),
            Err(ReconcileError::BadParam(_))
        ));
    }

    #[test]
    fn currency_is_normalized_and_bad_timestamp_rejected() {
        let filter = ReconcileFilter::parse(&query(None, None, None, Some(" cny ")), "CNY")
            .expect("币种去空格并大写");
        assert_eq!(filter.currency, "CNY");
        assert!(matches!(
            ReconcileFilter::parse(&query(Some(i64::MAX), Some(1), None, None), "CNY"),
            Err(ReconcileError::BadParam(_))
        ));
    }

    #[test]
    fn errors_map_to_expected_codes() {
        assert_eq!(
            Exception::from(ReconcileError::WindowInvalid("x".to_string())).code,
            business::payment::RECONCILE_WINDOW_INVALID
        );
        assert_eq!(
            Exception::from(ReconcileError::Kernel(billing::ReconcileError::Overflow)).code,
            business::payment::RECONCILE_AMOUNT_OVERFLOW
        );
        assert_eq!(
            Exception::from(ReconcileError::BadParam("x".to_string())).code,
            request::INVALID_PARAMETER_VALUE
        );
    }
}
