//! 阿里云出站策略层：把 `aliyun` 配置翻译成 `aliyun` crate 的调用。
//!
//! 分工：**协议**（签名、RPC 形状、错误信封）在 `aliyun` crate 里；**策略**（用哪个签名
//! 的模板、发件人、默认值）在这里。上层只看到「发短信验证码 / 发邮件验证码 / 拿 OSS 客户端」，
//! 不需要知道 `SendSms` 这类产品动作名。
//!
//! 协议客户端每次调用现场构造（而不是缓存在字段里）：OTP 发送本身被冷却时间限住，构建
//! 成本可以忽略；反过来，把凭据钉在长生命周期对象上会让密钥轮换（见 P8）没有落地点。

use std::time::Duration;

use aliyun::{
    Credentials, MailClient, MailError, MailMessage, OssClient, OssSettings, SignatureVersion,
    SmsClient, SmsError, SmsMessage,
};

use crate::configures::configure::{
    AliyunMailConfig, AliyunOssConfig, AliyunSmsConfig, Configure, MAIL_CODE_PLACEHOLDER,
};

/// 短信模板里的验证码变量名（阿里云短信模板的变量名由模板定义，本项目统一用 `code`）。
const CODE_TEMPLATE_PARAM: &str = "code";

#[derive(Debug, thiserror::Error)]
pub enum AliyunError {
    /// 配置缺项（凭据、签名/模板、bucket…）：一定是部署问题，不是对端问题。
    #[error("阿里云配置不完整：{0}")]
    NotConfigured(String),
    /// 被上游限流：唯一「重试有意义」的类别，调用方可以据此返回 429 而不是 502。
    #[error("阿里云限流：{0}")]
    RateLimited(String),
    #[error("阿里云调用失败：{0}")]
    Failed(String),
}

/// 一次调用所需的全部配置快照。
#[derive(Debug, Clone)]
pub struct AliyunClient {
    credentials: Credentials,
    version: SignatureVersion,
    timeout: Duration,
    sms: AliyunSmsConfig,
    mail: AliyunMailConfig,
    oss: AliyunOssConfig,
}

impl AliyunClient {
    /// 只做「凭据是否齐全」的判定；签名/模板的缺项在各方法里报，因为不是每条链路都用到它们。
    pub fn from_configure(config: &Configure) -> Result<Self, AliyunError> {
        let credentials = Credentials::new(
            &config.aliyun.access_key_id,
            &config.aliyun.access_key_secret,
        );
        if !credentials.is_configured() {
            return Err(AliyunError::NotConfigured(
                "aliyun.access_key_id / aliyun.access_key_secret".to_string(),
            ));
        }
        let version =
            SignatureVersion::parse(&config.aliyun.signature_version).ok_or_else(|| {
                AliyunError::NotConfigured(format!(
                    "不认识的 aliyun.signature_version：{}",
                    config.aliyun.signature_version
                ))
            })?;

        Ok(Self {
            credentials,
            version,
            timeout: Duration::from_millis(config.aliyun_timeout_ms()),
            sms: config.aliyun_sms().clone(),
            mail: config.aliyun_mail().clone(),
            oss: config.aliyun_oss().clone(),
        })
    }

    pub fn signature_version(&self) -> SignatureVersion {
        self.version
    }

    /// 发短信验证码，返回上游 `BizId`（只用于日志与排错）。
    pub async fn send_sms_code(&self, phone: &str, code: &str) -> Result<String, AliyunError> {
        let sign_name = self.sms.sign_name.trim();
        if sign_name.is_empty() {
            return Err(AliyunError::NotConfigured(
                "aliyun.sms.sign_name".to_string(),
            ));
        }
        let template_code = self.sms.template_code.trim();
        if template_code.is_empty() {
            return Err(AliyunError::NotConfigured(
                "aliyun.sms.template_code".to_string(),
            ));
        }

        let client = SmsClient::new(self.credentials.clone(), self.version, self.timeout)
            .map_err(|error| AliyunError::Failed(error.to_string()))?;
        let message =
            SmsMessage::new(phone, sign_name, template_code).with_param(CODE_TEMPLATE_PARAM, code);

        client
            .send(self.sms.endpoint.trim(), &message)
            .await
            .map(|receipt| receipt.biz_id)
            .map_err(map_sms_error)
    }

    /// 发邮件验证码，返回上游 `EnvId`（DirectMail 的投递 id）。
    pub async fn send_mail_code(
        &self,
        to_address: &str,
        code: &str,
    ) -> Result<Option<String>, AliyunError> {
        let account_name = self.mail.account_name.trim();
        if account_name.is_empty() {
            return Err(AliyunError::NotConfigured(
                "aliyun.mail.account_name".to_string(),
            ));
        }
        let subject = self.mail.subject.trim();
        if subject.is_empty() {
            return Err(AliyunError::NotConfigured(
                "aliyun.mail.subject".to_string(),
            ));
        }
        let body = render_body(&self.mail.body_template, code)?;

        let client = MailClient::new(self.credentials.clone(), self.version, self.timeout)
            .map_err(|error| AliyunError::Failed(error.to_string()))?;
        let mut message = MailMessage::new(account_name, to_address, subject).with_text_body(body);
        message.address_type = self.mail.address_type;
        message.reply_to_address = self.mail.reply_to_address;
        message.from_alias = non_empty(self.mail.from_alias.trim());

        client
            .send(self.mail.endpoint.trim(), &message)
            .await
            .map(|receipt| receipt.env_id)
            .map_err(map_mail_error)
    }

    /// OSS 连接信息（不含凭据）。bucket 未配置就是「本部署不使用对象存储」。
    pub fn oss_settings(&self) -> Result<OssSettings, AliyunError> {
        let bucket = self.oss.bucket.trim();
        if bucket.is_empty() {
            return Err(AliyunError::NotConfigured("aliyun.oss.bucket".to_string()));
        }

        let mut settings = OssSettings::new(self.oss.endpoint.trim(), bucket)
            .with_root(self.oss.root.trim())
            .with_addressing_style(self.oss.addressing_style.trim());
        if let Some(endpoint) = non_empty(self.oss.presign_endpoint.trim()) {
            settings = settings.with_presign_endpoint(endpoint);
        }

        Ok(settings)
    }

    /// 预签名 URL 的有效期（配置值的下界是 1 秒，避免出现「立刻过期」的链接）。
    pub fn presign_expires(&self) -> Duration {
        Duration::from_secs(self.oss.presign_expires_secs.max(1))
    }

    /// 对象存储客户端（put/get/delete/预签名）。
    pub fn oss(&self) -> Result<OssClient, AliyunError> {
        let settings = self.oss_settings()?;
        OssClient::new(settings, self.credentials.clone())
            .map_err(|error| AliyunError::Failed(error.to_string()))
    }
}

/// 模板替换：只认 `{code}` 一个占位符。缺占位符就地报错，避免发出「没有验证码的验证码邮件」。
fn render_body(template: &str, code: &str) -> Result<String, AliyunError> {
    if !template.contains(MAIL_CODE_PLACEHOLDER) {
        return Err(AliyunError::NotConfigured(format!(
            "aliyun.mail.body_template 必须包含 {MAIL_CODE_PLACEHOLDER}"
        )));
    }

    Ok(template.replace(MAIL_CODE_PLACEHOLDER, code))
}

fn map_sms_error(error: SmsError) -> AliyunError {
    if error.is_rate_limited() {
        return AliyunError::RateLimited(error.to_string());
    }

    AliyunError::Failed(error.to_string())
}

/// DirectMail 的错误信封里没有稳定的限流码分类，统一按失败处理（调用方一律回 502）。
fn map_mail_error(error: MailError) -> AliyunError {
    AliyunError::Failed(error.to_string())
}

fn non_empty(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configured() -> Configure {
        let mut config = Configure::test("0123456789012345678901234567890123");
        config.aliyun.access_key_id = "ak".to_string();
        config.aliyun.access_key_secret = "sk".to_string();
        config.aliyun.sms.sign_name = "某应用".to_string();
        config.aliyun.sms.template_code = "SMS_1".to_string();
        config.aliyun.mail.account_name = "noreply@example.com".to_string();
        config
    }

    #[test]
    fn from_configure_requires_credentials() {
        let config = Configure::test("0123456789012345678901234567890123");

        assert!(matches!(
            AliyunClient::from_configure(&config),
            Err(AliyunError::NotConfigured(_))
        ));
    }

    #[test]
    fn from_configure_rejects_unknown_signature_version() {
        let mut config = configured();
        config.aliyun.signature_version = "v9".to_string();

        assert!(matches!(
            AliyunClient::from_configure(&config),
            Err(AliyunError::NotConfigured(_))
        ));
    }

    #[test]
    fn from_configure_defaults_to_v3() {
        let client = AliyunClient::from_configure(&configured()).expect("client");

        assert_eq!(client.signature_version(), SignatureVersion::V3);
        assert_eq!(client.timeout, Duration::from_millis(10_000));
    }

    #[test]
    fn render_body_substitutes_code() {
        assert_eq!(
            render_body("验证码 {code} 有效", "123456").expect("render"),
            "验证码 123456 有效"
        );
    }

    #[test]
    fn render_body_requires_placeholder() {
        assert!(matches!(
            render_body("验证码 有效", "123456"),
            Err(AliyunError::NotConfigured(_))
        ));
    }

    #[test]
    fn oss_settings_requires_bucket() {
        let client = AliyunClient::from_configure(&configured()).expect("client");

        assert!(matches!(
            client.oss_settings(),
            Err(AliyunError::NotConfigured(_))
        ));
    }

    #[test]
    fn oss_settings_carry_style_and_presign_endpoint() {
        let mut config = configured();
        config.aliyun.oss.endpoint = "http://127.0.0.1:9000".to_string();
        config.aliyun.oss.bucket = "bucket".to_string();
        config.aliyun.oss.root = "assets".to_string();
        config.aliyun.oss.addressing_style = "path".to_string();
        config.aliyun.oss.presign_endpoint = "https://cdn.example.com".to_string();
        config.aliyun.oss.presign_expires_secs = 0;
        let client = AliyunClient::from_configure(&config).expect("client");

        let settings = client.oss_settings().expect("settings");
        assert_eq!(settings.bucket, "bucket");
        assert_eq!(settings.root, "assets");
        assert_eq!(settings.addressing_style, "path");
        assert_eq!(
            settings.presign_endpoint.as_deref(),
            Some("https://cdn.example.com")
        );
        assert_eq!(client.presign_expires(), Duration::from_secs(1));
    }
}
