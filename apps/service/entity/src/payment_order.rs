use sea_orm::entity::prelude::*;

/// 支付订单：一笔「档位购买」的完整生命周期（下单 → 支付 → 开通订阅）。
///
/// 金额与时长在**下单时快照落库**，此后一切校验（回调金额核对、续期时长）都以本表为准，
/// 避免配置改动或客户端参数影响已创建订单。
#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "payment_order")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: Uuid,
    /// 平台订单号；与上游交易绑定（微信 `out_trade_no` / 支付宝 `out_trade_no`），全局唯一
    #[sea_orm(column_name = "orderNo", column_type = "Text")]
    pub order_no: String,
    #[sea_orm(column_name = "tenantID", indexed)]
    pub tenant_id: Uuid,
    /// 下单用户（支付成功后的订阅 creator 与订单归属人）
    #[sea_orm(column_name = "userID", indexed)]
    pub user_id: Uuid,
    /// 购买的档位名，对应 `gateway.plan_daily_token_quota` 的 key
    #[sea_orm(column_type = "Text")]
    pub plan: String,
    /// 支付渠道：WECHAT / ALIPAY
    #[sea_orm(column_type = "Text")]
    pub channel: String,
    /// 应付金额（**分**，CNY）
    pub amount: i64,
    /// 币种，当前仅 CNY
    #[sea_orm(column_type = "Text")]
    pub currency: String,
    /// PENDING（待支付）/ PAID（已支付）/ CLOSED（超时或取消）
    #[sea_orm(column_type = "Text")]
    pub status: String,
    /// 开通时长（天）；NULL = 永久有效（与 `subscription.expiresAt` 同语义）
    #[sea_orm(column_name = "durationDays", column_type = "Integer", nullable)]
    pub duration_days: Option<i32>,
    /// 上游交易号（微信 `transaction_id` / 支付宝 `trade_no`）
    #[sea_orm(column_name = "transactionID", column_type = "Text", nullable)]
    pub transaction_id: Option<String>,
    /// 支付二维码内容（微信 `code_url` / 支付宝 `qr_code`），前端据此渲染二维码
    #[sea_orm(column_name = "codeUrl", column_type = "Text", nullable)]
    pub code_url: Option<String>,
    /// 支付成功后开通的订阅 ID；为 NULL 且状态为 PAID 表示「已收款未开通」，需对账补开
    #[sea_orm(column_name = "subscriptionID", nullable)]
    pub subscription_id: Option<Uuid>,
    #[sea_orm(column_name = "paidAt", nullable)]
    pub paid_at: Option<DateTimeWithTimeZone>,
    /// 订单超时时间：超过后不再受理支付（惰性关单）
    #[sea_orm(column_name = "expiresAt")]
    pub expires_at: DateTimeWithTimeZone,
    /// 异常处理备注（上游下单失败、金额不符、迟到支付等）
    #[sea_orm(column_type = "Text", nullable)]
    pub remark: Option<String>,
    #[sea_orm(column_name = "archivedAt", nullable)]
    pub archived_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_name = "createdAt")]
    pub created_at: DateTimeWithTimeZone,
    pub creator: Option<Uuid>,
    #[sea_orm(column_name = "updatedAt")]
    pub updated_at: DateTimeWithTimeZone,
    pub updater: Option<Uuid>,
}

impl ActiveModelBehavior for ActiveModel {}
