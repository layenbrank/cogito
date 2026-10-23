//! 短信：Dysmsapi `SendSms`（`2017-05-25`）。业务参数全部 `in: query`。
//!
//! 成功响应是 `{"Code":"OK","Message":"OK","BizId":…,"RequestId":…}`；失败同样以 `Code`
//! 表达（`isv.xxx` 系列），所以两条路径都要看 `Code`，不能只看 HTTP 状态。

use std::time::Duration;

use serde_json::{Map, Value};

use crate::rpc::{
    Credentials, ParamPlacement, RpcClient, RpcError, RpcRequest, SignatureVersion, non_empty,
};

pub const DEFAULT_ENDPOINT: &str = "https://dysmsapi.aliyuncs.com";

/// 中国内地「北京」专用代理（跨境/内网场景可选，不是默认）。
pub const BEIJING_PROXY_ENDPOINT: &str = "https://dysmsapi-proxy.cn-beijing.aliyuncs.com";

const ACTION: &str = "SendSms";
const VERSION: &str = "2017-05-25";

/// 已知的限流错误码（比较时忽略大小写：官方返回的是 `isv.BUSINESS_LIMIT_CONTROL`，
/// 但历史实现里出现过不同大小写，不要做精确匹配）。
const RATE_LIMIT_CODES: [&str; 3] = [
    "isv.BUSINESS_LIMIT_CONTROL",
    "isv.DAY_LIMIT_CONTROL",
    "isv.MONTH_LIMIT_CONTROL",
];

#[derive(Debug)]
pub struct SmsClient {
    rpc: RpcClient,
}

impl SmsClient {
    pub fn new(
        credentials: Credentials,
        version: SignatureVersion,
        timeout: Duration,
    ) -> Result<Self, RpcError> {
        Ok(Self {
            rpc: RpcClient::new(credentials, version, timeout)?,
        })
    }

    /// `endpoint` 由调用方给（配置项）：默认用 [`DEFAULT_ENDPOINT`]。
    pub async fn send(&self, endpoint: &str, message: &SmsMessage) -> Result<SmsReceipt, SmsError> {
        let phone = message.phone.trim();
        if phone.is_empty() {
            return Err(SmsError::Invalid("phone is required".to_owned()));
        }
        let sign_name = message.sign_name.trim();
        if sign_name.is_empty() {
            return Err(SmsError::Invalid("sign_name is required".to_owned()));
        }
        let template_code = message.template_code.trim();
        if template_code.is_empty() {
            return Err(SmsError::Invalid("template_code is required".to_owned()));
        }
        // `TemplateParam` 是「JSON 的字符串」，不是嵌套对象。
        let template_param = serde_json::to_string(&message.template_param)
            .map_err(|error| SmsError::Invalid(format!("template_param 无法序列化：{error}")))?;

        let request = RpcRequest::new(endpoint, ACTION, VERSION, ParamPlacement::Query)
            .param("PhoneNumbers", phone)
            .param("SignName", sign_name)
            .param("TemplateCode", template_code)
            .param("TemplateParam", template_param);

        match self.rpc.call(&request).await {
            Ok(value) => receipt(&value),
            Err(RpcError::Service {
                code,
                message,
                request_id,
                ..
            }) => Err(rejected(code, message, request_id)),
            Err(error) => Err(SmsError::Rpc(error)),
        }
    }
}

/// 一条短信。模板、签名与默认值由调用方（service 层）决定，这里只负责发送。
#[derive(Debug, Clone)]
pub struct SmsMessage {
    pub phone: String,
    pub sign_name: String,
    pub template_code: String,
    /// 模板变量（如 `{"code":"123456"}`）；空表会序列化成 `{}`。
    pub template_param: Map<String, Value>,
}

impl SmsMessage {
    pub fn new(
        phone: impl Into<String>,
        sign_name: impl Into<String>,
        template_code: impl Into<String>,
    ) -> Self {
        Self {
            phone: phone.into(),
            sign_name: sign_name.into(),
            template_code: template_code.into(),
            template_param: Map::new(),
        }
    }

    #[must_use]
    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.template_param
            .insert(key.into(), Value::String(value.into()));
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmsReceipt {
    pub biz_id: String,
    pub request_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum SmsError {
    /// 参数在本地就不合法（不消耗配额，调用方据此区分「请求方的问题」与「上游的问题」）。
    #[error("短信参数无效：{0}")]
    Invalid(String),
    #[error("短信被阿里云限流（{code}）：{message}")]
    RateLimited {
        code: String,
        message: String,
        request_id: Option<String>,
    },
    #[error("短信被阿里云拒绝（{code}）：{message}")]
    Rejected {
        code: String,
        message: String,
        request_id: Option<String>,
    },
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

impl SmsError {
    /// 限流是「重试有用」的唯一一类失败，调用方需要能把它单独归类。
    pub fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited { .. })
    }
}

fn receipt(value: &Value) -> Result<SmsReceipt, SmsError> {
    let code = str_field(value, "Code");
    let message = str_field(value, "Message");
    let request_id = non_empty(&str_field(value, "RequestId"));

    if !code.eq_ignore_ascii_case("OK") {
        return Err(rejected(code, message, request_id));
    }

    Ok(SmsReceipt {
        biz_id: str_field(value, "BizId"),
        request_id,
    })
}

fn rejected(code: String, message: String, request_id: Option<String>) -> SmsError {
    if is_rate_limit(&code) {
        return SmsError::RateLimited {
            code,
            message,
            request_id,
        };
    }

    SmsError::Rejected {
        code,
        message,
        request_id,
    }
}

fn is_rate_limit(code: &str) -> bool {
    RATE_LIMIT_CODES
        .iter()
        .any(|known| known.eq_ignore_ascii_case(code))
}

fn str_field(value: &Value, name: &str) -> String {
    value
        .get(name)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_rate_limit_codes_case_insensitively() {
        assert!(is_rate_limit("isv.BUSINESS_LIMIT_CONTROL"));
        assert!(is_rate_limit("ISV.DAY_LIMIT_CONTROL"));
        assert!(!is_rate_limit("isv.SMS_DAY_LIMIT_CONTROL"));
        assert!(!is_rate_limit(""));
    }

    #[test]
    fn parses_success_receipt() {
        let value: Value = serde_json::from_str(
            r#"{"Code":"OK","Message":"OK","BizId":"9006197469364984400","RequestId":"F655A8D5"}"#,
        )
        .expect("json");

        let receipt = receipt(&value).expect("ok");
        assert_eq!(receipt.biz_id, "9006197469364984400");
        assert_eq!(receipt.request_id.as_deref(), Some("F655A8D5"));
    }

    #[test]
    fn maps_business_limit_to_rate_limited() {
        let value: Value = serde_json::from_str(
            r#"{"Code":"isv.BUSINESS_LIMIT_CONTROL","Message":"触发天级流控","RequestId":""}"#,
        )
        .expect("json");

        let error = receipt(&value).expect_err("should fail");
        assert!(error.is_rate_limited());
    }

    #[test]
    fn maps_other_codes_to_rejected() {
        let value: Value =
            serde_json::from_str(r#"{"Code":"isv.TEMPLATE_MISSING_PARAMETERS","Message":"缺参"}"#)
                .expect("json");

        match receipt(&value).expect_err("should fail") {
            SmsError::Rejected { code, message, .. } => {
                assert_eq!(code, "isv.TEMPLATE_MISSING_PARAMETERS");
                assert_eq!(message, "缺参");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn builds_template_param_json() {
        let message = SmsMessage::new("13800000000", "签名", "SMS_1000").with_param("code", "1234");
        assert_eq!(
            serde_json::to_string(&message.template_param).expect("json"),
            r#"{"code":"1234"}"#
        );
    }
}
