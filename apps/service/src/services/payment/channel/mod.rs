//! 渠道注册表与统一渠道接口（下单 / 回调验签 / 主动查单）。
//!
//! 设计：**渠道元数据表驱动**（[`CHANNELS`]），**行为用 `match` 分派**——异步 trait 方法
//! 在 dyn 下不可用，与其引 `async-trait` 增加一层间接，不如让新增渠道的改动集中在
//! 「补一条元数据 + 三个分派分支」，落点明确、易扩展。

pub mod alipay;
pub mod signature;
pub mod wechat;

use std::time::Duration;

use chrono::{DateTime, FixedOffset};
use reqwest::Client;

use crate::configures::configure::{Configure, PayConfig};
use crate::services::payment::channel::signature::SignatureError;

/// 微信支付渠道标识（对外契约：请求体 `channel`、订单表 `channel` 列、回调路径）。
pub const WECHAT: &str = "WECHAT";
/// 支付宝渠道标识。
pub const ALIPAY: &str = "ALIPAY";

/// 上游接口超时：支付下单是同步等待用户的动作，超时过长会拖住请求。
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(10);

/// 渠道元数据 + 可用性判定。
pub struct ChannelSpec {
    pub code: &'static str,
    pub label: &'static str,
    /// `Ok` = 可下单；`Err` = 不可用原因（未开通、凭据缺失），下发给客户端展示
    pub check: fn(&PayConfig) -> Result<(), String>,
}

/// 渠道目录（表驱动）。
pub const CHANNELS: &[ChannelSpec] = &[
    ChannelSpec {
        code: WECHAT,
        label: "微信支付",
        check: check_wechat,
    },
    ChannelSpec {
        code: ALIPAY,
        label: "支付宝",
        check: check_alipay,
    },
];

/// 按渠道标识查元数据（大小写不敏感）。
pub fn find(code: &str) -> Option<&'static ChannelSpec> {
    let wanted = code.trim().to_ascii_uppercase();
    CHANNELS.iter().find(|spec| spec.code == wanted)
}

fn check_wechat(config: &PayConfig) -> Result<(), String> {
    let wechat = &config.wechat;
    if !wechat.enabled {
        return Err("渠道未开通".to_string());
    }
    let required = [
        ("商户号", wechat.mch_id.as_str()),
        ("appid", wechat.app_id.as_str()),
        ("APIv3 密钥", wechat.api_v3_key.as_str()),
        ("证书序列号", wechat.serial_no.as_str()),
        ("商户私钥", wechat.private_key.as_str()),
        ("平台证书公钥", wechat.platform_public_key.as_str()),
        ("回调地址", wechat.notify_url.as_str()),
    ];
    match required.iter().find(|(_, value)| value.trim().is_empty()) {
        Some((name, _)) => Err(format!("商户凭据缺失：{name}")),
        None => Ok(()),
    }
}

fn check_alipay(config: &PayConfig) -> Result<(), String> {
    let alipay = &config.alipay;
    if !alipay.enabled {
        return Err("渠道未开通".to_string());
    }
    let required = [
        ("应用 app_id", alipay.app_id.as_str()),
        ("应用私钥", alipay.private_key.as_str()),
        ("支付宝公钥", alipay.alipay_public_key.as_str()),
        ("网关地址", alipay.gateway_url.as_str()),
        ("回调地址", alipay.notify_url.as_str()),
    ];
    match required.iter().find(|(_, value)| value.trim().is_empty()) {
        Some((name, _)) => Err(format!("应用凭据缺失：{name}")),
        None => Ok(()),
    }
}

/// 渠道层错误；上层统一映射为业务错误码。
#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("channel unavailable: {0}")]
    Unavailable(String),
    #[error("unsupported channel: {0}")]
    Unsupported(String),
    #[error("invalid signature: {0}")]
    Signature(String),
    #[error("malformed payload: {0}")]
    Malformed(String),
    #[error("upstream error: {0}")]
    Upstream(String),
}

impl From<SignatureError> for ChannelError {
    fn from(err: SignatureError) -> Self {
        match err {
            SignatureError::Verify => Self::Signature("签名校验失败".to_string()),
            other => Self::Malformed(other.to_string()),
        }
    }
}

/// 下单入参：金额与服务端订单一致（单位「分」）。
pub struct PrepayInput<'a> {
    pub order_no: &'a str,
    pub amount: i64,
    pub currency: &'a str,
    pub subject: &'a str,
    pub expires_at: DateTime<FixedOffset>,
}

/// 回调原始输入。微信需要签名头，支付宝只需表单体（签名在体内）。
pub struct NotifyInput<'a> {
    pub body: &'a str,
    pub timestamp: Option<&'a str>,
    pub nonce: Option<&'a str>,
    pub signature: Option<&'a str>,
    pub serial: Option<&'a str>,
}

/// 回调结果（验签 / 解密后的事实）。
pub struct NotifyOutcome {
    pub order_no: String,
    pub transaction_id: Option<String>,
    pub amount: i64,
    pub currency: String,
    /// 上游是否判定「已付款成功」
    pub paid: bool,
}

/// 主动查单结果。
pub struct RemoteOrder {
    pub paid: bool,
    /// 上游已关单（超时未支付 / 用户取消）
    pub closed: bool,
    pub transaction_id: Option<String>,
    pub amount: Option<i64>,
    pub currency: Option<String>,
}

/// 生成支付凭证（微信 `code_url` / 支付宝 `qr_code`），客户端据此渲染二维码。
pub async fn prepay(
    config: &Configure,
    channel: &str,
    input: &PrepayInput<'_>,
) -> Result<String, ChannelError> {
    require_ready(config, channel)?;
    match find(channel).map(|spec| spec.code) {
        Some(WECHAT) => wechat::prepay(config, input).await,
        Some(ALIPAY) => alipay::prepay(config, input).await,
        _ => Err(ChannelError::Unsupported(channel.to_string())),
    }
}

/// 校验回调真伪并取出「付款事实」。**必须**在改单状态前调用。
pub fn verify_notify(
    config: &Configure,
    channel: &str,
    input: &NotifyInput<'_>,
) -> Result<NotifyOutcome, ChannelError> {
    match find(channel).map(|spec| spec.code) {
        Some(WECHAT) => wechat::verify_notify(config, input),
        Some(ALIPAY) => alipay::verify_notify(config, input),
        _ => Err(ChannelError::Unsupported(channel.to_string())),
    }
}

/// 主动向上游查单（回调丢失时的兜底，也用于用户手动「刷新支付状态」）。
pub async fn query(
    config: &Configure,
    channel: &str,
    order_no: &str,
) -> Result<RemoteOrder, ChannelError> {
    require_ready(config, channel)?;
    match find(channel).map(|spec| spec.code) {
        Some(WECHAT) => wechat::query(config, order_no).await,
        Some(ALIPAY) => alipay::query(config, order_no).await,
        _ => Err(ChannelError::Unsupported(channel.to_string())),
    }
}

/// 渠道可用性检查（下单 / 查单前统一入口，避免拿着空凭据去打上游）。
pub fn require_ready(
    config: &Configure,
    channel: &str,
) -> Result<&'static ChannelSpec, ChannelError> {
    let spec = find(channel).ok_or_else(|| ChannelError::Unsupported(channel.to_string()))?;
    (spec.check)(&config.pay).map_err(ChannelError::Unavailable)?;
    Ok(spec)
}

/// 渠道可用性（供目录接口展示：不可用时带原因）。
pub fn availability(config: &Configure, channel: &str) -> (String, String, bool, Option<String>) {
    match find(channel) {
        Some(spec) => match (spec.check)(&config.pay) {
            Ok(()) => (spec.code.to_string(), spec.label.to_string(), true, None),
            Err(reason) => (
                spec.code.to_string(),
                spec.label.to_string(),
                false,
                Some(reason),
            ),
        },
        None => (
            channel.to_string(),
            channel.to_string(),
            false,
            Some("渠道不支持".to_string()),
        ),
    }
}

/// 出站客户端：支付调用频次低，复用同一个连接池即可（超时固定 10s）。
pub(crate) fn http() -> &'static Client {
    static CLIENT: std::sync::OnceLock<Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(UPSTREAM_TIMEOUT)
            .connect_timeout(UPSTREAM_TIMEOUT)
            .build()
            .expect("failed to build payment http client")
    })
}

/// 读取上游错误响应体里的 `code` / `message`，拼成可排查的错误串。
pub(crate) fn upstream_error(status: reqwest::StatusCode, body: &str) -> ChannelError {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            let code = value.get("code").and_then(|v| v.as_str())?;
            let message = value
                .get("message")
                .and_then(|v| v.as_str())
                .or_else(|| value.get("sub_msg").and_then(|v| v.as_str()))
                .unwrap_or_default();
            Some(format!("{code}: {message}"))
        })
        .unwrap_or_else(|| body.chars().take(200).collect());
    ChannelError::Upstream(format!("HTTP {status} {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configures::configure::PayConfig;

    #[test]
    fn disabled_channels_report_reason() {
        let config = Configure::test("test-secret-test-secret-test-secret");
        let (code, label, enabled, reason) = availability(&config, "wechat");
        assert_eq!(code, WECHAT);
        assert_eq!(label, "微信支付");
        assert!(!enabled);
        assert_eq!(reason.as_deref(), Some("渠道未开通"));
    }

    #[test]
    fn enabled_channel_without_credentials_is_unavailable() {
        let mut pay = PayConfig::default();
        pay.wechat.enabled = true;
        assert!(check_wechat(&pay).is_err());
        pay.wechat.mch_id = "1900000001".to_string();
        pay.wechat.app_id = "wx123".to_string();
        pay.wechat.api_v3_key = "01234567890123456789012345678901".to_string();
        pay.wechat.serial_no = "SERIAL".to_string();
        pay.wechat.private_key = "PEM".to_string();
        pay.wechat.platform_public_key = "PEM".to_string();
        pay.wechat.notify_url = "https://example.com/notify".to_string();
        assert!(check_wechat(&pay).is_ok());
    }

    #[test]
    fn unknown_channel_is_unsupported() {
        let config = Configure::test("test-secret-test-secret-test-secret");
        assert!(matches!(
            require_ready(&config, "PAYPAL"),
            Err(ChannelError::Unsupported(_))
        ));
    }
}
