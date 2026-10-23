//! 邮件：DirectMail `SingleSendMail`（`2015-11-23`）。业务参数全部 `in: formData`，
//! 所以是 `POST` + `application/x-www-form-urlencoded` body。
//!
//! 官方元数据里成功响应只有 `EnvId` 与 `RequestId`，失败走 4xx + `{Code,Message,RequestId}`
//! 信封；这里额外兜一层「HTTP 200 但带 `Code`」，避免上游改成 200 后静默当成成功。

use std::time::Duration;

use serde_json::Value;

use crate::rpc::{
    Credentials, ParamPlacement, RpcClient, RpcError, RpcRequest, SignatureVersion, non_empty,
};

pub const DEFAULT_ENDPOINT: &str = "https://dm.aliyuncs.com";

const ACTION: &str = "SingleSendMail";
const VERSION: &str = "2015-11-23";

#[derive(Debug)]
pub struct MailClient {
    rpc: RpcClient,
}

impl MailClient {
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
    pub async fn send(
        &self,
        endpoint: &str,
        message: &MailMessage,
    ) -> Result<MailReceipt, MailError> {
        let account_name = message.account_name.trim();
        if account_name.is_empty() {
            return Err(MailError::Invalid("account_name is required".to_owned()));
        }
        let to_address = message.to_address.trim();
        if to_address.is_empty() {
            return Err(MailError::Invalid("to_address is required".to_owned()));
        }
        let subject = message.subject.trim();
        if subject.is_empty() {
            return Err(MailError::Invalid("subject is required".to_owned()));
        }
        if message.address_type > 1 {
            return Err(MailError::Invalid(
                "address_type 只支持 0（发信地址）或 1（随机账号）".to_owned(),
            ));
        }
        let text_body = message.text_body.as_deref().unwrap_or_default().trim();
        let html_body = message.html_body.as_deref().unwrap_or_default().trim();
        if text_body.is_empty() && html_body.is_empty() {
            return Err(MailError::Invalid(
                "text_body 与 html_body 至少要有一个".to_owned(),
            ));
        }

        let mut request = RpcRequest::new(endpoint, ACTION, VERSION, ParamPlacement::Form)
            .param("AccountName", account_name)
            .param("AddressType", message.address_type.to_string())
            .param(
                "ReplyToAddress",
                if message.reply_to_address {
                    "true"
                } else {
                    "false"
                },
            )
            .param("ToAddress", to_address)
            .param("Subject", subject);
        if let Some(alias) = message.from_alias.as_deref().and_then(non_empty) {
            request = request.param("FromAlias", alias);
        }
        if !text_body.is_empty() {
            request = request.param("TextBody", text_body);
        }
        if !html_body.is_empty() {
            request = request.param("HtmlBody", html_body);
        }

        match self.rpc.call(&request).await {
            Ok(value) => receipt(&value),
            Err(RpcError::Service {
                code,
                message,
                request_id,
                ..
            }) => Err(MailError::Rejected {
                code,
                message,
                request_id,
            }),
            Err(error) => Err(MailError::Rpc(error)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct MailMessage {
    /// 控制台里验证过的发信地址（DirectMail 的 `AccountName`）。
    pub account_name: String,
    /// 发件人显示名。
    pub from_alias: Option<String>,
    pub to_address: String,
    pub subject: String,
    pub text_body: Option<String>,
    pub html_body: Option<String>,
    /// `0`：用 `account_name` 指定的发信地址；`1`：随机账号（官方默认）。两者至少要有一个可用。
    pub address_type: u8,
    /// 是否把回信地址设为本信的发信地址。
    pub reply_to_address: bool,
}

impl MailMessage {
    pub fn new(
        account_name: impl Into<String>,
        to_address: impl Into<String>,
        subject: impl Into<String>,
    ) -> Self {
        Self {
            account_name: account_name.into(),
            from_alias: None,
            to_address: to_address.into(),
            subject: subject.into(),
            text_body: None,
            html_body: None,
            address_type: 1,
            reply_to_address: true,
        }
    }

    #[must_use]
    pub fn with_text_body(mut self, body: impl Into<String>) -> Self {
        self.text_body = Some(body.into());
        self
    }

    #[must_use]
    pub fn with_html_body(mut self, body: impl Into<String>) -> Self {
        self.html_body = Some(body.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailReceipt {
    /// DirectMail 的投递 id（用来查投递详情）。
    pub env_id: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MailError {
    #[error("邮件参数无效：{0}")]
    Invalid(String),
    #[error("邮件被阿里云拒绝（{code}）：{message}")]
    Rejected {
        code: String,
        message: String,
        request_id: Option<String>,
    },
    #[error(transparent)]
    Rpc(#[from] RpcError),
}

fn receipt(value: &Value) -> Result<MailReceipt, MailError> {
    let code = value
        .get("Code")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    if !code.is_empty() && !code.eq_ignore_ascii_case("OK") {
        return Err(MailError::Rejected {
            code,
            message: value
                .get("Message")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            request_id: value
                .get("RequestId")
                .and_then(Value::as_str)
                .and_then(non_empty),
        });
    }

    Ok(MailReceipt {
        env_id: value
            .get("EnvId")
            .and_then(Value::as_str)
            .and_then(non_empty),
        request_id: value
            .get("RequestId")
            .and_then(Value::as_str)
            .and_then(non_empty),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_success_receipt() {
        let value: Value = serde_json::from_str(
            r#"{"EnvId":"xxx@example.com","RequestId":"8C4E7F2A-1F52-4E3A-9C9A-1D4B7D6C6C42"}"#,
        )
        .expect("json");

        let receipt = receipt(&value).expect("ok");
        assert_eq!(receipt.env_id.as_deref(), Some("xxx@example.com"));
        assert!(receipt.request_id.is_some());
    }

    #[test]
    fn treats_200_with_error_code_as_rejected() {
        let value: Value = serde_json::from_str(
            r#"{"Code":"InvalidMailAddress","Message":"收件地址不合法","RequestId":"abc"}"#,
        )
        .expect("json");

        match receipt(&value).expect_err("should fail") {
            MailError::Rejected {
                code, request_id, ..
            } => {
                assert_eq!(code, "InvalidMailAddress");
                assert_eq!(request_id.as_deref(), Some("abc"));
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn accepts_missing_env_id() {
        let value: Value = serde_json::from_str(r#"{"RequestId":"abc"}"#).expect("json");
        assert_eq!(receipt(&value).expect("ok").env_id, None);
    }
}
