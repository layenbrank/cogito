//! 支付宝（当面付 `alipay.trade.precreate` 扫码）。
//!
//! - 下单：`alipay.trade.precreate` → `qr_code`
//! - 查单：`alipay.trade.query`
//! - 回调：异步通知表单验签（排除 `sign` / `sign_type`），成功必须回纯文本 `success`
//!
//! 签名算法：`RSA2`（SHA256withRSA），待签串为**按 key 升序**拼接的 `k=v&k=v`
//! （值取原文，不做 URL 编码）；响应验签对象是对应业务节点的**原始 JSON 文本**。

use chrono::{FixedOffset, Utc};
use reqwest::header::{ACCEPT, CONTENT_TYPE, USER_AGENT};
use serde_json::{Value, json, value::RawValue};

use crate::configures::configure::Configure;
use crate::services::payment::channel::signature::{
    SignatureError, load_private_key, load_public_key, sign_sha256, verify_sha256, yuan_to_cents,
};
use crate::services::payment::channel::{
    ChannelError, NotifyInput, NotifyOutcome, PrepayInput, RemoteOrder, http, upstream_error,
};

fn cst() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("valid offset")
}

fn now_text() -> String {
    Utc::now()
        .with_timezone(&cst())
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

/// 「分」→ 元字符串（两位小数），避免浮点误差。
pub(crate) fn cents_to_yuan(cents: i64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

/// 按 key 升序拼接待签串；空值不参与签名（支付宝规则）。
pub(crate) fn canonical(params: &[(String, String)]) -> String {
    let mut pairs: Vec<&(String, String)> = params
        .iter()
        .filter(|(key, value)| {
            !value.is_empty() && key.as_str() != "sign" && key.as_str() != "sign_type"
        })
        .collect();
    pairs.sort_by(|left, right| left.0.cmp(&right.0));
    pairs
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn sign_params(private_key_pem: &str, params: &[(String, String)]) -> Result<String, ChannelError> {
    let private_key = load_private_key(private_key_pem)?;
    Ok(sign_sha256(&private_key, canonical(params).as_bytes())?)
}

fn verify_params(
    public_key_pem: &str,
    params: &[(String, String)],
    sign: &str,
) -> Result<(), ChannelError> {
    let public_key = load_public_key(public_key_pem)?;
    verify_sha256(&public_key, canonical(params).as_bytes(), sign).map_err(|err| match err {
        SignatureError::Verify => ChannelError::Signature("支付宝签名校验失败".to_string()),
        other => ChannelError::from(other),
    })
}

/// 组装公共请求参数（含 `biz_content`）并签名。
fn signed_params(
    config: &Configure,
    method: &str,
    biz: Value,
) -> Result<Vec<(String, String)>, ChannelError> {
    let alipay = &config.pay.alipay;
    let mut params: Vec<(String, String)> = vec![
        ("app_id".to_string(), alipay.app_id.clone()),
        ("method".to_string(), method.to_string()),
        ("format".to_string(), "JSON".to_string()),
        ("charset".to_string(), "utf-8".to_string()),
        ("sign_type".to_string(), "RSA2".to_string()),
        ("timestamp".to_string(), now_text()),
        ("version".to_string(), "1.0".to_string()),
        ("notify_url".to_string(), alipay.notify_url.clone()),
        ("biz_content".to_string(), biz.to_string()),
    ];
    let sign = sign_params(&alipay.private_key, &params)?;
    params.push(("sign".to_string(), sign));
    Ok(params)
}

fn encode_form(params: &[(String, String)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(
            params
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .finish()
}

/// 解析响应外层结构（业务节点 + 签名）。
///
/// 支付宝响应形如 `{"<node>": {...}, "sign": "..."}`，用 `Value` 往返会改变键序 / 空格，
/// 因此业务节点用 `&RawValue` 原样保留 —— 验签对象必须是它的**原始 JSON 文本**。
fn parse_body<'a, T: serde::Deserialize<'a>>(body: &'a str) -> Result<T, ChannelError> {
    serde_json::from_str(body)
        .map_err(|err| ChannelError::Malformed(format!("支付宝响应解析失败: {err}")))
}

/// 校验响应签名并返回业务节点。
fn verify_node(
    config: &Configure,
    node: &RawValue,
    sign: Option<String>,
) -> Result<Value, ChannelError> {
    let sign = sign.ok_or_else(|| ChannelError::Signature("支付宝响应缺少签名".to_string()))?;
    let public_key = load_public_key(&config.pay.alipay.alipay_public_key)?;
    verify_sha256(&public_key, node.get().as_bytes(), &sign).map_err(|err| match err {
        SignatureError::Verify => ChannelError::Signature("支付宝响应签名校验失败".to_string()),
        other => ChannelError::from(other),
    })?;

    serde_json::from_str::<Value>(node.get())
        .map_err(|err| ChannelError::Malformed(format!("支付宝响应节点解析失败: {err}")))
}

/// 各接口的业务节点名不同，用宏生成外层结构体（避免为每个接口重复写样板）。
macro_rules! signed_response {
    ($name:ident, $key:literal) => {
        #[derive(serde::Deserialize)]
        struct $name<'a> {
            #[serde(rename = $key, borrow)]
            node: &'a RawValue,
            sign: Option<String>,
        }
    };
}

signed_response!(PrecreateResponse, "alipay_trade_precreate_response");
signed_response!(QueryResponse, "alipay_trade_query_response");

/// 业务节点里的字符串字段。
fn field(node: &Value, name: &str) -> Option<String> {
    node.get(name).and_then(|value| match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        _ => None,
    })
}

fn ensure_ok(node: &Value) -> Result<(), ChannelError> {
    match field(node, "code").as_deref() {
        Some("10000") => Ok(()),
        _ => {
            let code = field(node, "sub_code")
                .or_else(|| field(node, "code"))
                .unwrap_or_default();
            let message = field(node, "sub_msg")
                .or_else(|| field(node, "msg"))
                .unwrap_or_default();
            Err(ChannelError::Upstream(format!("{code}: {message}")))
        }
    }
}

async fn call(config: &Configure, params: &[(String, String)]) -> Result<String, ChannelError> {
    let alipay = &config.pay.alipay;
    let response = http()
        .post(alipay.gateway_url.trim())
        .header(ACCEPT, "application/json")
        .header(
            CONTENT_TYPE,
            "application/x-www-form-urlencoded;charset=utf-8",
        )
        .header(USER_AGENT, "cogito-service/1.0")
        .body(encode_form(params))
        .send()
        .await
        .map_err(|err| ChannelError::Upstream(format!("请求支付宝网关失败: {err}")))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|err| ChannelError::Upstream(format!("读取支付宝响应失败: {err}")))?;
    if !status.is_success() {
        return Err(upstream_error(status, &text));
    }
    Ok(text)
}

/// 扫码下单，返回 `qr_code`。
pub async fn prepay(config: &Configure, input: &PrepayInput<'_>) -> Result<String, ChannelError> {
    // 支付宝要求绝对超时时间不早于 1 分钟后：本地订单仍按 expires_at 关单，
    // 这里只放宽「上游可见的」有效期，避免因调用往返耗时而下单失败。
    let floor = Utc::now() + chrono::Duration::minutes(2);
    let deadline = if input.expires_at > floor {
        input.expires_at
    } else {
        floor.with_timezone(&cst())
    };
    let biz = json!({
        "out_trade_no": input.order_no,
        "total_amount": cents_to_yuan(input.amount),
        "subject": input.subject,
        "time_expire": deadline
            .with_timezone(&cst())
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
    });
    let params = signed_params(config, "alipay.trade.precreate", biz)?;
    let body = call(config, &params).await?;
    let parsed: PrecreateResponse = parse_body(&body)?;
    let node = verify_node(config, parsed.node, parsed.sign)?;
    ensure_ok(&node)?;

    field(&node, "qr_code")
        .ok_or_else(|| ChannelError::Malformed("支付宝下单响应缺少 qr_code".to_string()))
}

/// 主动查单。
pub async fn query(config: &Configure, order_no: &str) -> Result<RemoteOrder, ChannelError> {
    let biz = json!({ "out_trade_no": order_no });
    let params = signed_params(config, "alipay.trade.query", biz)?;
    let body = call(config, &params).await?;
    let parsed: QueryResponse = parse_body(&body)?;
    let node = verify_node(config, parsed.node, parsed.sign)?;

    // 交易不存在：`ACQ.TRADE_NOT_EXIST`，视为未支付（交由本地超时关单）
    if field(&node, "sub_code").as_deref() == Some("ACQ.TRADE_NOT_EXIST") {
        return Ok(RemoteOrder {
            paid: false,
            closed: false,
            transaction_id: None,
            amount: None,
            currency: None,
        });
    }
    ensure_ok(&node)?;

    let status = field(&node, "trade_status").unwrap_or_default();
    let amount = field(&node, "total_amount")
        .map(|value| yuan_to_cents(&value).map_err(ChannelError::from))
        .transpose()?;
    Ok(RemoteOrder {
        paid: matches!(status.as_str(), "TRADE_SUCCESS" | "TRADE_FINISHED"),
        closed: matches!(status.as_str(), "TRADE_CLOSED"),
        transaction_id: field(&node, "trade_no"),
        amount,
        currency: Some("CNY".to_string()),
    })
}

/// 回调验签。
pub fn verify_notify(
    config: &Configure,
    input: &NotifyInput<'_>,
) -> Result<NotifyOutcome, ChannelError> {
    let alipay = &config.pay.alipay;
    let params: Vec<(String, String)> = url::form_urlencoded::parse(input.body.as_bytes())
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    if params.is_empty() {
        return Err(ChannelError::Malformed("支付宝回调表单为空".to_string()));
    }
    let sign = params
        .iter()
        .find(|(key, _)| key == "sign")
        .map(|(_, value)| value.clone())
        .ok_or_else(|| ChannelError::Signature("支付宝回调缺少签名".to_string()))?;
    if let Some((_, sign_type)) = params.iter().find(|(key, _)| key == "sign_type")
        && sign_type.eq_ignore_ascii_case("RSA")
    {
        return Err(ChannelError::Signature(
            "仅接受 RSA2 签名（RSA 已过时）".to_string(),
        ));
    }
    verify_params(&alipay.alipay_public_key, &params, &sign)?;

    let get = |name: &str| {
        params
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    // 防串号：回调必须由本应用发起
    match get("app_id") {
        Some(app_id) if app_id == alipay.app_id => {}
        _ => {
            return Err(ChannelError::Signature(
                "支付宝回调 app_id 与配置不一致".to_string(),
            ));
        }
    }

    let order_no = get("out_trade_no")
        .ok_or_else(|| ChannelError::Malformed("支付宝回调缺少 out_trade_no".to_string()))?;
    let amount = get("total_amount")
        .ok_or_else(|| ChannelError::Malformed("支付宝回调缺少 total_amount".to_string()))
        .and_then(|value| yuan_to_cents(&value).map_err(ChannelError::from))?;
    let status = get("trade_status").unwrap_or_default();

    Ok(NotifyOutcome {
        order_no,
        transaction_id: get("trade_no"),
        amount,
        currency: "CNY".to_string(),
        paid: matches!(status.as_str(), "TRADE_SUCCESS" | "TRADE_FINISHED"),
    })
}

/// 支付宝回调成功应答：**纯文本** `success`（不是平台响应信封，也不是 JSON）。
pub const NOTIFY_ACK: &str = "success";
/// 支付宝回调失败应答：`failure`（支付宝会按重试策略重发）。
pub const NOTIFY_FAIL: &str = "failure";

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_PRIVATE_KEY: &str = include_str!("testdata/rsa_test_private.pem");
    const TEST_PUBLIC_KEY: &str = include_str!("testdata/rsa_test_public.pem");

    #[test]
    fn cents_to_yuan_keeps_two_decimals() {
        assert_eq!(cents_to_yuan(1900), "19.00");
        assert_eq!(cents_to_yuan(1909), "19.09");
        assert_eq!(cents_to_yuan(5), "0.05");
        assert_eq!(cents_to_yuan(100000), "1000.00");
    }

    #[test]
    fn canonical_sorts_and_skips_sign() {
        let params = vec![
            ("b".to_string(), "2".to_string()),
            ("sign".to_string(), "XXX".to_string()),
            ("a".to_string(), "1".to_string()),
            ("empty".to_string(), String::new()),
            ("sign_type".to_string(), "RSA2".to_string()),
        ];
        assert_eq!(canonical(&params), "a=1&b=2");
    }

    #[test]
    fn sign_and_verify_form() {
        let params = vec![
            ("out_trade_no".to_string(), "P20260101".to_string()),
            ("total_amount".to_string(), "19.00".to_string()),
            ("trade_status".to_string(), "TRADE_SUCCESS".to_string()),
        ];
        let sign = sign_params(TEST_PRIVATE_KEY, &params).unwrap();
        assert!(verify_params(TEST_PUBLIC_KEY, &params, &sign).is_ok());

        let tampered = vec![
            ("out_trade_no".to_string(), "P20260101".to_string()),
            ("total_amount".to_string(), "0.01".to_string()),
            ("trade_status".to_string(), "TRADE_SUCCESS".to_string()),
        ];
        assert!(verify_params(TEST_PUBLIC_KEY, &tampered, &sign).is_err());
    }

    /// 响应验签对象必须是业务节点的原始 JSON 文本（含键序与空白），重新序列化会失败。
    #[test]
    fn response_signature_covers_raw_node() {
        let raw_node = "{\"code\":\"10000\",\"msg\":\"Success\",\"out_trade_no\":\"P1\"}";
        let sign = {
            let private = load_private_key(TEST_PRIVATE_KEY).unwrap();
            sign_sha256(&private, raw_node.as_bytes()).unwrap()
        };
        let body =
            format!("{{\"alipay_trade_precreate_response\":{raw_node},\"sign\":\"{sign}\"}}");
        let parsed: PrecreateResponse = parse_body(&body).unwrap();
        assert_eq!(parsed.node.get(), raw_node);

        // 端到端：外层结构 → 验签 → 业务节点
        let mut config = Configure::test("test-secret-test-secret-test-secret");
        config.pay.alipay.alipay_public_key = TEST_PUBLIC_KEY.to_string();
        let node = verify_node(&config, parsed.node, parsed.sign).unwrap();
        assert_eq!(field(&node, "out_trade_no").as_deref(), Some("P1"));
    }

    #[test]
    fn ensure_ok_surfaces_sub_code() {
        let node = json!({ "code": "40004", "msg": "Business Failed", "sub_code": "ACQ.TRADE_HAS_SUCCESS" });
        let err = ensure_ok(&node).unwrap_err();
        assert!(err.to_string().contains("ACQ.TRADE_HAS_SUCCESS"));
    }
}
