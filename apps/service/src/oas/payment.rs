use super::common::{CatalogEnvelope, Exception, OrderEnvelope, OrderListEnvelope};
use crate::services::payment::schema::OrderP;

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/pay/catalog",
    tag = "Payment",
    operation_id = "payment.catalog",
    summary = "可售档位与支付渠道",
    description = "收银台唯一数据源：档位价格由服务端定价，渠道按配置返回可用性与不可用原因。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = CatalogEnvelope),
        (status = "default", description = "业务异常（非个人租户或权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn catalog_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/orders",
    tag = "Payment",
    operation_id = "payment.toList",
    summary = "订单历史",
    description = "按创建时间倒序返回最近 20 条；返回前会惰性关闭已超时的待支付订单。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    responses(
        (status = 200, description = "成功", body = OrderListEnvelope),
        (status = "default", description = "业务异常（权限不足）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toList_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants/{id}/orders",
    tag = "Payment",
    operation_id = "payment.toWrite",
    summary = "创建支付订单",
    description = "**金额由服务端按档位定价**，请求体只接受档位与渠道；\
                   同一用户 + 档位 + 渠道的未过期待支付订单会直接复用（避免重复下单）。\
                   返回 `codeUrl` 由客户端渲染二维码，`orderExpiresAt` 为支付截止时间。",
    security(("bearer_auth" = [])),
    params(("id" = String, Path, description = "租户 ID")),
    request_body(content = OrderP, description = "档位与支付渠道"),
    responses(
        (status = 200, description = "成功", body = OrderEnvelope),
        (status = "default", description = "业务异常（档位不可购买 / 渠道未配置 / 上游下单失败）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toWrite_doc() {}

#[utoipa::path(
    get,
    path = "/api/v1/tenants/{id}/orders/{orderNo}",
    tag = "Payment",
    operation_id = "payment.toReadByNo",
    summary = "订单详情",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("orderNo" = String, Path, description = "商户订单号"),
    ),
    responses(
        (status = 200, description = "成功", body = OrderEnvelope),
        (status = "default", description = "业务异常（订单不存在）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn toRead_by_no_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants/{id}/orders/{orderNo}/sync",
    tag = "Payment",
    operation_id = "payment.sync",
    summary = "同步支付状态",
    description = "回调丢失时的兜底（也是「刷新支付状态」按钮的实现）：向渠道查单，\
                   支付成功则核销并开通订阅；已收款未开通会自动补齐；超时未支付则关单。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("orderNo" = String, Path, description = "商户订单号"),
    ),
    responses(
        (status = 200, description = "成功", body = OrderEnvelope),
        (status = "default", description = "业务异常（订单不存在 / 上游查询失败）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn sync_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/tenants/{id}/orders/{orderNo}/close",
    tag = "Payment",
    operation_id = "payment.close",
    summary = "关闭订单",
    description = "仅待支付订单可关闭；已支付订单返回 `500402`。",
    security(("bearer_auth" = [])),
    params(
        ("id" = String, Path, description = "租户 ID"),
        ("orderNo" = String, Path, description = "商户订单号"),
    ),
    responses(
        (status = 200, description = "成功", body = OrderEnvelope),
        (status = "default", description = "业务异常（订单不存在 / 已支付不可关闭）：HTTP 状态码按错误码归属返回，响应体为统一错误信封", body = Exception),
    )
)]
pub fn close_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/pay/notify/wechat",
    tag = "Payment",
    operation_id = "payment.notifyWechat",
    summary = "微信支付回调",
    description = "**渠道服务器调用，匿名**：验签（`Wechatpay-Signature` + 平台证书公钥）、\
                   APIv3 密钥解密 `resource`、金额与币种核对、幂等核销。\
                   响应不是平台信封：成功 `{\"code\":\"SUCCESS\"}`（HTTP 200），\
                   失败 `{\"code\":\"FAIL\"}`（HTTP 500，微信会重试）。",
    request_body(content = String, description = "微信回调原始 JSON 报文（验签对象即原始 body）"),
    responses(
        (status = 200, description = "已受理", content_type = "application/json"),
        (status = 500, description = "验签或处理失败，微信将重试", content_type = "application/json"),
    )
)]
pub fn notify_wechat_doc() {}

#[utoipa::path(
    post,
    path = "/api/v1/pay/notify/alipay",
    tag = "Payment",
    operation_id = "payment.notifyAlipay",
    summary = "支付宝回调",
    description = "**支付宝服务器调用，匿名**：表单参数 RSA2 验签、`app_id` 防串号、金额核对、\
                   幂等核销。响应不是平台信封：成功返回**纯文本** `success`，\
                   失败返回 `failure`（支付宝按重试策略重发）。",
    request_body(content = String, description = "支付宝异步通知表单原文"),
    responses(
        (status = 200, description = "已受理：成功返回纯文本 `success`，验签失败或订单不存在返回 `failure`（支付宝按重试策略重发）", content_type = "text/plain"),
    )
)]
pub fn notify_alipay_doc() {}
