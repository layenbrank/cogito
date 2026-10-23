use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// 创建订单请求。
///
/// **只接受档位与渠道**：金额由服务端按 `pay.plans` 定价，客户端无法指定价格。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderP {
    /// 档位名（须同时存在于 `pay.plans` 与 `gateway.planDailyTokenQuota`）
    pub plan: String,
    /// 支付渠道：`WECHAT` / `ALIPAY`
    pub channel: String,
}

/// 订单视图。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrderR {
    #[serde(rename = "orderNo")]
    pub order_no: String,
    #[serde(rename = "tenantID")]
    pub tenant_id: String,
    pub plan: String,
    pub channel: String,
    /// 金额（**分**）
    pub amount: i64,
    pub currency: String,
    /// `PENDING` / `PAID` / `CLOSED` / `REFUNDED`
    pub status: String,
    /// 支付凭证链接（微信 `weixin://wxpay/...`；支付宝 `https://qr.alipay.com/...`），
    /// 客户端据此渲染二维码；异常情况下可能为 null，此时可调用 `sync` 重新获取
    pub code_url: Option<String>,
    /// 上游交易号（微信 `transaction_id` / 支付宝 `trade_no`），未支付为 null
    pub transaction_id: Option<String>,
    /// 开通后生效的订阅 ID，未开通为 null
    #[serde(rename = "subscriptionID")]
    pub subscription_id: Option<String>,
    /// 档位对应的日 token 配额（展示用）
    pub daily_token_quota: i64,
    /// 生效时长（天）；null = 永久
    pub duration_days: Option<i32>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    /// 支付截止时间（超过即自动关单）
    pub order_expires_at: i64,
    pub paid_at: Option<i64>,
    pub remark: Option<String>,
}

/// 可售档位。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatalogPlanR {
    pub plan: String,
    pub label: String,
    pub amount: i64,
    pub currency: String,
    /// 生效时长（天）；null = 永久
    pub duration_days: Option<i32>,
    pub daily_token_quota: i64,
    /// 是否可下单（未定价 / 档位已下线时为 false）
    pub purchasable: bool,
    /// 不可下单原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 支付渠道。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatalogChannelR {
    pub code: String,
    pub label: String,
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// 价格 / 渠道目录：客户端渲染「档位 → 渠道 → 下单」三步的唯一数据源。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CatalogR {
    pub currency: String,
    /// 订单有效期（秒）
    pub order_ttl_secs: u64,
    pub plans: Vec<CatalogPlanR>,
    pub channels: Vec<CatalogChannelR>,
    /// 当前租户当前生效档位；null = 免费档
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_plan: Option<String>,
}

// ---- 模型价目表（平台运维面，挂 `/api/v1/billing/prices`）----

/// 价目列表查询参数。**不做分页**：一个平台的价目量级是「型号数 × 改价次数」，
/// 量小到一次取全更利于核对；因此只提供收窄条件。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceQueryP {
    /// 租户收窄；缺省 = 不过滤（含平台默认价）
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: Option<String>,
    /// 只看此刻生效的窗口（未归档 且 `effectiveFrom <= now < effectiveTo`）
    pub active_only: Option<bool>,
    /// 是否包含已归档价目（缺省 false）
    pub include_archived: Option<bool>,
}

/// 新建价目。
///
/// `currency` 缺省取结算币种；给了就必须等于结算币种（对账只在同一币种里比金额）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceWriteP {
    /// `null` = 平台默认价，`Some` = 该租户的专属价（取价时专属价优先）
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: String,
    pub currency: Option<String>,
    /// 分 / 百万 token
    pub input_price_per_million: i64,
    /// 分 / 百万 token
    pub output_price_per_million: i64,
    /// 生效起点（毫秒时间戳，含）
    pub effective_from: i64,
    /// 生效终点（毫秒时间戳，不含；null = 长期生效）
    pub effective_to: Option<i64>,
}

/// 改价目：**只开放 `modelName` 与 `effectiveTo`**。
///
/// 金额与生效起点不可改：历史用量必须能被「当时的单价」唯一复算，一旦允许原地改价，
/// 过去的账目就会随之后的一次编辑而漂移。改价 = 关旧窗口（本接口补 `effectiveTo`）
/// + 建新窗口（`POST /billing/prices`）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceUpdateP {
    /// 型号名快照；缺省不动
    pub model_name: Option<String>,
    /// 把窗口收窄到此刻之前；缺省不动（窗口一旦收窄就不能再退回长期生效）
    pub effective_to: Option<i64>,
}

/// 价目视图。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PriceR {
    pub id: String,
    /// `null` = 平台默认价
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: String,
    pub model_name: String,
    pub currency: String,
    /// 分 / 百万 token
    pub input_price_per_million: i64,
    /// 分 / 百万 token
    pub output_price_per_million: i64,
    /// 生效起点（毫秒时间戳，含）
    pub effective_from: i64,
    /// 生效终点（毫秒时间戳，不含）；缺省 = 长期生效
    #[serde(skip_serializing_if = "Option::is_none")]
    pub effective_to: Option<i64>,
    /// 此刻是否生效（未归档 且 窗口覆盖 now）
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---- 计量对账（平台运维面，挂 `/api/v1/billing/reconciliation`）----

/// 对账窗口参数。窗口是**左闭右开** `[from, to)`，单位毫秒；缺省最近 24 小时。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileQueryP {
    /// 窗口起点（毫秒，含）；缺省 = 终点往前 24 小时
    pub from: Option<i64>,
    /// 窗口终点（毫秒，不含）；缺省 = 此刻
    pub to: Option<i64>,
    /// 只对这一个租户对账；缺省 = 全平台
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    /// 结算币种；缺省取服务配置里的结算币种
    pub currency: Option<String>,
}

/// 对账导出参数：与查询同一组窗口条件，外加导出格式（缺省 CSV）。
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileExportP {
    pub from: Option<i64>,
    pub to: Option<i64>,
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub currency: Option<String>,
    pub format: Option<ReconcileExportFormat>,
}

/// 导出格式：`csv`（Excel 友好，带 UTF-8 BOM）或 `ndjson`（流式消费友好）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ReconcileExportFormat {
    Csv,
    Ndjson,
}

/// 对账合计（分）。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileTotalsR {
    /// 用量折算金额（分），只含结算币种
    pub usage_amount: i64,
    /// 订单实收（分），只含结算币种
    pub order_amount: i64,
    /// `usageAmount - orderAmount`：正数 = 用了没付，负数 = 付了没用
    pub delta: i64,
    pub usage_requests: i64,
    /// 没有匹配到价目的请求数（金额未计入）
    pub unpriced_requests: i64,
    /// `status != 'OK'` 的请求数（只计数，不折算金额）
    pub failed_requests: i64,
    /// 因币种不一致被排除在 `usageAmount` 之外的金额
    pub mismatched_amount: i64,
    /// 因币种不一致被排除在 `orderAmount` 之外的金额
    pub mismatched_order_amount: i64,
    pub paid_orders: i64,
}

/// 单租户合计。`tenantID` 为 null 表示用量没有归属租户。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileTenantR {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    pub totals: ReconcileTotalsR,
}

/// 型号明细：每一行都能用「token 数 × 单价」独立复算。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileModelR {
    #[serde(rename = "tenantID")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID")]
    pub model_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_name: Option<String>,
    /// 命中并生效的那条价目；null = 未定价
    #[serde(rename = "priceID", skip_serializing_if = "Option::is_none")]
    pub price_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_price_per_million: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_price_per_million: Option<i64>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub requests: i64,
    /// null = 未定价；此时租户合计只是「下限」
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    /// 币种与结算币种不一致，金额被排除在合计之外
    pub mismatched_currency: bool,
}

/// 需要人工确认的一条异常。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileExceptionR {
    /// 类型码：`UNPRICED_USAGE` / `CURRENCY_MISMATCH` / `USAGE_WITHOUT_ORDER` /
    /// `ORDER_WITHOUT_USAGE` / `PAID_NOT_ACTIVATED` / `REMARKED`
    pub kind: String,
    /// 类型码的中文说明
    pub description: String,
    #[serde(rename = "tenantID", skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    #[serde(rename = "modelID", skip_serializing_if = "Option::is_none")]
    pub model_id: Option<String>,
    #[serde(rename = "orderNo", skip_serializing_if = "Option::is_none")]
    pub order_no: Option<String>,
    /// 涉及金额（分）；未定价与纯计数类异常为 null
    #[serde(skip_serializing_if = "Option::is_none")]
    pub amount: Option<i64>,
    pub detail: String,
}

/// 一次对账的完整结果。
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileR {
    /// 窗口起点（毫秒，含）
    pub from: i64,
    /// 窗口终点（毫秒，不含）
    pub to: i64,
    /// 结算币种
    pub currency: String,
    pub totals: ReconcileTotalsR,
    pub tenants: Vec<ReconcileTenantR>,
    pub models: Vec<ReconcileModelR>,
    pub exceptions: Vec<ReconcileExceptionR>,
}
