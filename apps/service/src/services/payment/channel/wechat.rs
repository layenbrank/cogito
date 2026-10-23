//! 微信支付（APIv3 / Native 扫码）。
//!
//! - 下单：`POST /v3/pay/transactions/native` → `code_url`
//! - 查单：`GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid=...`
//! - 回调：`Wechatpay-Signature` 验签 + APIv3 密钥解密 `resource`
//!
//! 签名算法：`SHA256withRSA`（PKCS#1 v1.5），待签串
//! `METHOD\nURL_PATH\nTIMESTAMP\nNONCE\nBODY\n`（回调为 `TIMESTAMP\nNONCE\nBODY\n`）。

use chrono::{FixedOffset, SecondsFormat, Utc};
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, USER_AGENT};
use serde::Deserialize;
use serde_json::json;

use crate::configures::configure::Configure;
use crate::services::payment::channel::signature::{
    SignatureError, WechatResource, decrypt_wechat_resource, random_nonce, sign_sha256,
};
use crate::services::payment::channel::{
    ChannelError, NotifyInput, NotifyOutcome, PrepayInput, RemoteOrder, http, upstream_error,
};

/// 东八区：微信 `time_expire` 与成功时间都按 +08:00 交付。
fn cst() -> FixedOffset {
    FixedOffset::east_opt(8 * 3600).expect("valid offset")
}

/// 微信待签串（请求与回调规则不同，故拆成两个显式函数，避免调用方拼错）。
pub(crate) fn request_message(
    method: &str,
    url_path: &str,
    timestamp: &str,
    nonce: &str,
    body: &str,
) -> String {
    format!("{method}\n{url_path}\n{timestamp}\n{nonce}\n{body}\n")
}

/// 回调待签串。
pub(crate) fn notify_message(timestamp: &str, nonce: &str, body: &str) -> String {
    format!("{timestamp}\n{nonce}\n{body}\n")
}

fn authorization(
    config: &Configure,
    method: &str,
    url_path: &str,
    body: &str,
) -> Result<String, ChannelError> {
    let wechat = &config.pay.wechat;
    let private_key =
        crate::services::payment::channel::signature::load_private_key(&wechat.private_key)?;
    let timestamp = Utc::now().timestamp().to_string();
    let nonce = random_nonce();
    let signature = sign_sha256(
        &private_key,
        request_message(method, url_path, &timestamp, &nonce, body).as_bytes(),
    )?;
    Ok(format!(
        "WECHATPAY2-SHA256-RSA2048 mchid=\"{}\",nonce_str=\"{}\",timestamp=\"{}\",serial_no=\"{}\",signature=\"{}\"",
        wechat.mch_id, nonce, timestamp, wechat.serial_no, signature
    ))
}

/// 上游响应签名头（`Wechatpay-Timestamp` / `Nonce` / `Signature`）。
fn response_signature(headers: &HeaderMap) -> Option<(String, String, String)> {
    let read = |name: &str| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let timestamp = read("Wechatpay-Timestamp")?;
    let nonce = read("Wechatpay-Nonce")?;
    let signature = read("Wechatpay-Signature")?;
    Some((timestamp, nonce, signature))
}

/// 校验上游响应签名。
///
/// `strict` 用于**驱动业务状态**的响应（查单结果决定是否开通订阅），此时缺少签名头
/// 视为异常；对仅返回二维码链接的下单响应则记录告警后放行，避免因上游头部策略变化
/// 直接阻断下单。
fn verify_response(
    config: &Configure,
    headers: &HeaderMap,
    body: &str,
    strict: bool,
) -> Result<(), ChannelError> {
    match response_signature(headers) {
        Some((timestamp, nonce, signature)) => {
            let public_key = crate::services::payment::channel::signature::load_public_key(
                &config.pay.wechat.platform_public_key,
            )?;
            crate::services::payment::channel::signature::verify_sha256(
                &public_key,
                notify_message(&timestamp, &nonce, body).as_bytes(),
                &signature,
            )
            .map_err(|err| match err {
                SignatureError::Verify => {
                    ChannelError::Signature("微信响应签名校验失败".to_string())
                }
                other => ChannelError::from(other),
            })
        }
        None if strict => Err(ChannelError::Signature(
            "微信响应缺少签名头，拒绝采信".to_string(),
        )),
        None => {
            tracing::warn!(
                "wechat response without signature headers; body accepted for prepay only"
            );
            Ok(())
        }
    }
}

#[derive(Debug, Deserialize)]
struct Amount {
    total: i64,
    #[serde(default)]
    currency: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PrepayResponse {
    code_url: String,
}

#[derive(Debug, Deserialize)]
struct TradeState {
    #[serde(default)]
    trade_state: String,
    #[serde(default)]
    transaction_id: Option<String>,
    #[serde(default)]
    amount: Option<Amount>,
}

#[derive(Debug, Deserialize)]
struct NotifyBody {
    out_trade_no: String,
    #[serde(default)]
    transaction_id: Option<String>,
    #[serde(default)]
    trade_state: String,
    #[serde(default)]
    amount: Option<Amount>,
}

/// 扫码下单，返回 `code_url`（`weixin://wxpay/bizpayurl?...`）。
pub async fn prepay(config: &Configure, input: &PrepayInput<'_>) -> Result<String, ChannelError> {
    let wechat = &config.pay.wechat;
    let path = "/v3/pay/transactions/native";
    let body = json!({
        "appid": wechat.app_id,
        "mchid": wechat.mch_id,
        "description": input.subject,
        "out_trade_no": input.order_no,
        "time_expire": input.expires_at.with_timezone(&cst()).to_rfc3339_opts(SecondsFormat::Secs, false),
        "notify_url": wechat.notify_url,
        "amount": { "total": input.amount, "currency": input.currency },
    })
    .to_string();

    let response = http()
        .post(format!("{}{path}", wechat.api_base.trim_end_matches('/')))
        .header(AUTHORIZATION, authorization(config, "POST", path, &body)?)
        .header(ACCEPT, "application/json")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, "cogito-service/1.0")
        .body(body)
        .send()
        .await
        .map_err(|err| ChannelError::Upstream(format!("请求微信下单接口失败: {err}")))?;
    let status = response.status();
    let headers = response.headers().clone();
    let text = response
        .text()
        .await
        .map_err(|err| ChannelError::Upstream(format!("读取微信响应失败: {err}")))?;
    if !status.is_success() {
        return Err(upstream_error(status, &text));
    }
    verify_response(config, &headers, &text, false)?;

    serde_json::from_str::<PrepayResponse>(&text)
        .map(|parsed| parsed.code_url)
        .map_err(|err| ChannelError::Malformed(format!("微信下单响应解析失败: {err}")))
}

/// 主动查单。
pub async fn query(config: &Configure, order_no: &str) -> Result<RemoteOrder, ChannelError> {
    let wechat = &config.pay.wechat;
    let path = format!(
        "/v3/pay/transactions/out-trade-no/{order_no}?mchid={}",
        wechat.mch_id
    );
    let response = http()
        .get(format!("{}{path}", wechat.api_base.trim_end_matches('/')))
        .header(AUTHORIZATION, authorization(config, "GET", &path, "")?)
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "cogito-service/1.0")
        .send()
        .await
        .map_err(|err| ChannelError::Upstream(format!("请求微信查单接口失败: {err}")))?;
    let status = response.status();
    let headers = response.headers().clone();
    let text = response
        .text()
        .await
        .map_err(|err| ChannelError::Upstream(format!("读取微信响应失败: {err}")))?;

    // 订单不存在：视为未支付，交由本地订单状态机处理（超时关单）
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(RemoteOrder {
            paid: false,
            closed: false,
            transaction_id: None,
            amount: None,
            currency: None,
        });
    }
    if !status.is_success() {
        return Err(upstream_error(status, &text));
    }
    verify_response(config, &headers, &text, true)?;

    let parsed = serde_json::from_str::<TradeState>(&text)
        .map_err(|err| ChannelError::Malformed(format!("微信查单响应解析失败: {err}")))?;
    Ok(RemoteOrder {
        paid: parsed.trade_state == "SUCCESS",
        closed: matches!(
            parsed.trade_state.as_str(),
            "CLOSED" | "REVOKED" | "PAYERROR"
        ),
        transaction_id: parsed.transaction_id,
        amount: parsed.amount.as_ref().map(|amount| amount.total),
        currency: parsed.amount.and_then(|amount| amount.currency),
    })
}

/// 回调验签 + 解密。
pub fn verify_notify(
    config: &Configure,
    input: &NotifyInput<'_>,
) -> Result<NotifyOutcome, ChannelError> {
    let wechat = &config.pay.wechat;
    let (timestamp, nonce, signature) = match (input.timestamp, input.nonce, input.signature) {
        (Some(timestamp), Some(nonce), Some(signature)) => (timestamp, nonce, signature),
        _ => {
            return Err(ChannelError::Signature("微信回调缺少签名头".to_string()));
        }
    };
    if let Some(serial) = input.serial
        && !wechat.serial_no.trim().is_empty()
        && serial.trim() == wechat.serial_no.trim()
    {
        // 平台证书序列号不会等于商户证书序列号：出现这种情况说明不是平台发起的请求
        return Err(ChannelError::Signature("回调证书序列号异常".to_string()));
    }

    let public_key =
        crate::services::payment::channel::signature::load_public_key(&wechat.platform_public_key)?;
    crate::services::payment::channel::signature::verify_sha256(
        &public_key,
        notify_message(timestamp, nonce, input.body).as_bytes(),
        signature,
    )
    .map_err(|err| match err {
        SignatureError::Verify => ChannelError::Signature("微信回调签名校验失败".to_string()),
        other => ChannelError::from(other),
    })?;

    #[derive(Deserialize)]
    struct Envelope {
        resource: WechatResource,
    }
    let envelope = serde_json::from_str::<Envelope>(input.body)
        .map_err(|err| ChannelError::Malformed(format!("微信回调结构解析失败: {err}")))?;
    let plaintext = decrypt_wechat_resource(&wechat.api_v3_key, &envelope.resource)?;
    let body = serde_json::from_str::<NotifyBody>(&plaintext)
        .map_err(|err| ChannelError::Malformed(format!("微信回调解密内容解析失败: {err}")))?;

    let amount = body
        .amount
        .ok_or_else(|| ChannelError::Malformed("微信回调缺少金额".to_string()))?;

    Ok(NotifyOutcome {
        order_no: body.out_trade_no,
        transaction_id: body.transaction_id,
        amount: amount.total,
        currency: amount
            .currency
            .unwrap_or_else(|| "CNY".to_string())
            .to_uppercase(),
        paid: body.trade_state == "SUCCESS",
    })
}

/// 微信回调应答：**必须**按上游约定返回，不能套平台响应信封。
pub fn notify_ack(success: bool) -> (reqwest::StatusCode, String) {
    if success {
        (
            reqwest::StatusCode::OK,
            "{\"code\":\"SUCCESS\",\"message\":\"成功\"}".to_string(),
        )
    } else {
        (
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "{\"code\":\"FAIL\",\"message\":\"失败\"}".to_string(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn request_message_matches_api_v3_rule() {
        assert_eq!(
            request_message(
                "GET",
                "/v3/certificates",
                "1554208460",
                "593BEC0C930BF1AF",
                ""
            ),
            "GET\n/v3/certificates\n1554208460\n593BEC0C930BF1AF\n\n"
        );
    }

    #[test]
    fn notify_message_appends_trailing_newline() {
        assert_eq!(
            notify_message("1554208460", "nonce", "{\"id\":1}"),
            "1554208460\nnonce\n{\"id\":1}\n"
        );
    }

    #[test]
    fn expire_is_rendered_in_cst() {
        let utter = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let rendered = utter
            .with_timezone(&cst())
            .to_rfc3339_opts(SecondsFormat::Secs, false);
        assert_eq!(rendered, "2026-01-01T08:00:00+08:00");
    }

    #[test]
    fn notify_ack_uses_wechat_payload() {
        let (status, body) = notify_ack(true);
        assert_eq!(status, reqwest::StatusCode::OK);
        assert!(body.contains("SUCCESS"));
        let (status, _) = notify_ack(false);
        assert_eq!(status, reqwest::StatusCode::INTERNAL_SERVER_ERROR);
    }
}
