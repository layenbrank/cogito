//! 短信 / 邮件 OTP：发码、校验、冷却与失败锁定。

use fred::interfaces::KeysInterface;
use fred::prelude::*;
use rand::RngExt;

use crate::clients::aliyun::{AliyunClient, AliyunError};
use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::services::auth::schema::OtpChannel;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OtpPurpose {
    Login,
    PasswordReset,
}

impl OtpPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Login => "login",
            Self::PasswordReset => "password_reset",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OtpError {
    #[error("OTP rate limited")]
    RateLimited,
    #[error("OTP locked")]
    Locked,
    #[error("Invalid OTP")]
    Invalid,
    #[error("OTP expired")]
    Expired,
    #[error("OTP send failed")]
    SendFailed,
    #[error("Cache error: {0}")]
    Cache(String),
}

pub struct OtpService;

impl OtpService {
    pub async fn send(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
    ) -> Result<String, OtpError> {
        if Self::is_locked(redis, config, purpose, channel, target).await? {
            return Err(OtpError::Locked);
        }

        let rate_key = rate_key(purpose, channel, target);
        if redis
            .pool()
            .exists(rate_key.clone())
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?
        {
            return Err(OtpError::RateLimited);
        }

        let code = generate_code();
        Self::store_code(redis, config, purpose, channel, target, &code).await?;
        Self::dispatch_send(config, purpose, channel, target, &code).await?;
        Ok(code)
    }

    pub async fn send_same_code_to_targets(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        targets: &[(OtpChannel, &str)],
    ) -> Result<(), OtpError> {
        if targets.is_empty() {
            return Ok(());
        }

        for &(channel, target) in targets {
            if Self::is_locked(redis, config, purpose, channel, target).await? {
                return Err(OtpError::Locked);
            }
            let rate_key = rate_key(purpose, channel, target);
            if redis
                .pool()
                .exists(rate_key)
                .await
                .map_err(|e| OtpError::Cache(e.to_string()))?
            {
                return Err(OtpError::RateLimited);
            }
        }

        let code = generate_code();
        for &(channel, target) in targets {
            Self::store_code(redis, config, purpose, channel, target, &code).await?;
        }
        for &(channel, target) in targets {
            Self::dispatch_send(config, purpose, channel, target, &code).await?;
        }
        Ok(())
    }

    pub async fn verify(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
        code: &str,
    ) -> Result<(), OtpError> {
        if Self::is_locked(redis, config, purpose, channel, target).await? {
            return Err(OtpError::Locked);
        }

        let otp_key = otp_key(purpose, channel, target);
        let stored: Option<String> = redis
            .pool()
            .get(otp_key.clone())
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        let Some(stored) = stored else {
            return Err(OtpError::Expired);
        };

        if stored != code.trim() {
            Self::record_fail(redis, config, purpose, channel, target).await?;
            return Err(OtpError::Invalid);
        }

        redis
            .pool()
            .del::<(), _>(otp_key)
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        redis
            .pool()
            .del::<(), _>(fail_key(purpose, channel, target))
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        Ok(())
    }

    async fn store_code(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
        code: &str,
    ) -> Result<(), OtpError> {
        let ttl = config.auth.otp.ttl_secs.max(1);
        let otp_key = otp_key(purpose, channel, target);

        redis
            .pool()
            .set::<(), _, _>(
                otp_key,
                code.to_string(),
                Some(Expiration::EX(ttl as i64)),
                None,
                false,
            )
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        let cooldown = config.auth.otp.cooldown_secs.max(1);
        redis
            .pool()
            .set::<(), _, _>(
                rate_key(purpose, channel, target),
                "1",
                Some(Expiration::EX(cooldown as i64)),
                None,
                false,
            )
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        Ok(())
    }

    async fn dispatch_send(
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
        code: &str,
    ) -> Result<(), OtpError> {
        if config.auth.otp.mock {
            tracing::info!(
                event = "auth.otp.send",
                purpose = purpose.as_str(),
                channel = channel.as_str(),
                target = %mask_target(channel, target),
                code = %code,
                "otp mock send"
            );
            return Ok(());
        }

        let client = AliyunClient::from_configure(config).map_err(map_aliyun_build_error)?;

        match channel {
            OtpChannel::Phone => {
                let biz_id = client
                    .send_sms_code(target, code)
                    .await
                    .map_err(map_aliyun_error)?;
                tracing::info!(
                    event = "auth.otp.send",
                    purpose = purpose.as_str(),
                    channel = channel.as_str(),
                    target = %mask_target(channel, target),
                    biz_id = %biz_id,
                    "otp sms sent via aliyun"
                );
                Ok(())
            }
            OtpChannel::Email => {
                let env_id = client
                    .send_mail_code(target, code)
                    .await
                    .map_err(map_aliyun_error)?;
                tracing::info!(
                    event = "auth.otp.send",
                    purpose = purpose.as_str(),
                    channel = channel.as_str(),
                    target = %mask_target(channel, target),
                    env_id = env_id.as_deref().unwrap_or_default(),
                    "otp email sent via aliyun"
                );
                Ok(())
            }
        }
    }

    async fn is_locked(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
    ) -> Result<bool, OtpError> {
        let fails: Option<i64> = redis
            .pool()
            .get(fail_key(purpose, channel, target))
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        Ok(fails.unwrap_or(0) >= config.auth.otp.max_attempts as i64)
    }

    async fn record_fail(
        redis: &RedisPool,
        config: &Configure,
        purpose: OtpPurpose,
        channel: OtpChannel,
        target: &str,
    ) -> Result<(), OtpError> {
        let key = fail_key(purpose, channel, target);
        let count: i64 = redis
            .pool()
            .incr(key.clone())
            .await
            .map_err(|e| OtpError::Cache(e.to_string()))?;

        if count == 1 {
            let lock = config.auth.otp.lock_secs.max(1);
            let _: () = redis
                .pool()
                .expire(key, lock as i64, None)
                .await
                .map_err(|e| OtpError::Cache(e.to_string()))?;
        }

        Ok(())
    }
}

fn generate_code() -> String {
    let mut rng = rand::rng();
    format!("{:06}", rng.random_range(0..1_000_000))
}

fn otp_key(purpose: OtpPurpose, channel: OtpChannel, target: &str) -> String {
    format!(
        "auth:otp:{}:{}:{}",
        purpose.as_str(),
        channel.as_str(),
        normalize_target(target)
    )
}

fn rate_key(purpose: OtpPurpose, channel: OtpChannel, target: &str) -> String {
    format!(
        "auth:otp:rate:{}:{}:{}",
        purpose.as_str(),
        channel.as_str(),
        normalize_target(target)
    )
}

fn fail_key(purpose: OtpPurpose, channel: OtpChannel, target: &str) -> String {
    format!(
        "auth:otp:fail:{}:{}:{}",
        purpose.as_str(),
        channel.as_str(),
        normalize_target(target)
    )
}

fn normalize_target(target: &str) -> String {
    target.trim().to_ascii_lowercase()
}

fn map_aliyun_error(err: AliyunError) -> OtpError {
    match err {
        AliyunError::RateLimited(_) => OtpError::RateLimited,
        AliyunError::NotConfigured(_) | AliyunError::Failed(_) => OtpError::SendFailed,
    }
}

fn map_aliyun_build_error(err: AliyunError) -> OtpError {
    tracing::warn!(event = "auth.otp.send", error = %err, "aliyun client unavailable");
    OtpError::SendFailed
}

fn mask_target(channel: OtpChannel, target: &str) -> String {
    let t = target.trim();
    match channel {
        OtpChannel::Phone => {
            if t.len() <= 4 {
                return "***".to_string();
            }
            format!("{}****", t.chars().take(3).collect::<String>())
        }
        OtpChannel::Email => {
            if let Some((user, domain)) = t.split_once('@') {
                let masked = if user.len() <= 2 {
                    "*".to_string()
                } else {
                    format!("{}***", user.chars().take(1).collect::<String>())
                };
                format!("{masked}@{domain}")
            } else {
                "***".to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purpose_key_isolation() {
        let login = otp_key(OtpPurpose::Login, OtpChannel::Phone, "13800138000");
        let reset = otp_key(OtpPurpose::PasswordReset, OtpChannel::Phone, "13800138000");
        assert_ne!(login, reset);
        assert!(login.contains("login"));
        assert!(reset.contains("password_reset"));
    }
}
