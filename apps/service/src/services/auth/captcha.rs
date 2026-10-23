//! 行为验证码：go-captcha-service 代理、IP 限流。

use fred::interfaces::KeysInterface;

use crate::clients::gocaptcha::{CaptchaChallenge, GoCaptchaClient, GoCaptchaError};
use crate::clients::redis::RedisPool;
use crate::configures::configure::Configure;
use crate::services::auth::schema::CaptchaR;

pub struct CaptchaService;

impl CaptchaService {
    pub async fn create(
        redis: &RedisPool,
        config: &Configure,
        client_ip: &str,
        kind: Option<&str>,
    ) -> Result<CaptchaR, CaptchaError> {
        Self::check_ip_rate(redis, config, client_ip).await?;

        let client =
            GoCaptchaClient::new(config).map_err(|e| CaptchaError::Upstream(e.to_string()))?;
        let resolved = client.resolve_kind(kind);
        let challenge = client.get_data(&resolved).await?;

        Ok(map_challenge(&challenge))
    }

    pub async fn verify(
        config: &Configure,
        kind: Option<&str>,
        captcha_key: &str,
        captcha_value: &str,
    ) -> Result<(), CaptchaError> {
        if !config.captcha_enabled() {
            tracing::debug!(
                event = "auth.captcha.verify",
                skipped = true,
                "captcha disabled"
            );
            return Ok(());
        }

        let client =
            GoCaptchaClient::new(config).map_err(|e| CaptchaError::Upstream(e.to_string()))?;
        let resolved = client.resolve_kind(kind);
        client
            .check_data(&resolved, captcha_key, captcha_value)
            .await?;
        Ok(())
    }

    async fn check_ip_rate(
        redis: &RedisPool,
        config: &Configure,
        client_ip: &str,
    ) -> Result<(), CaptchaError> {
        let limit = config.captcha_ip_rate_limit();
        let key = format!("auth:captcha:rate:{client_ip}");
        let count: i64 = redis
            .pool()
            .incr(key.clone())
            .await
            .map_err(|e| CaptchaError::Cache(e.to_string()))?;

        if count == 1 {
            let _: () = redis
                .pool()
                .expire(key, 60, None)
                .await
                .map_err(|e| CaptchaError::Cache(e.to_string()))?;
        }

        if count > limit as i64 {
            return Err(CaptchaError::RateLimited);
        }

        Ok(())
    }
}

fn map_challenge(challenge: &CaptchaChallenge) -> CaptchaR {
    CaptchaR {
        kind: challenge.kind.clone(),
        captcha_key: challenge.captcha_key.clone(),
        master_image: challenge.master_image.clone(),
        thumb_image: challenge.thumb_image.clone(),
        thumb_x: challenge.thumb_x,
        thumb_y: challenge.thumb_y,
        thumb_width: challenge.thumb_width,
        thumb_height: challenge.thumb_height,
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CaptchaError {
    #[error("Captcha rate limited")]
    RateLimited,
    #[error("Invalid captcha")]
    Invalid,
    #[error("Captcha expired")]
    Expired,
    #[error("Cache error: {0}")]
    Cache(String),
    #[error("Captcha upstream error: {0}")]
    Upstream(String),
}

impl From<GoCaptchaError> for CaptchaError {
    fn from(err: GoCaptchaError) -> Self {
        match err {
            GoCaptchaError::RateLimited => Self::RateLimited,
            GoCaptchaError::Invalid => Self::Invalid,
            GoCaptchaError::Expired => Self::Expired,
            GoCaptchaError::Cache(msg) => Self::Cache(msg),
            GoCaptchaError::Upstream(msg) => Self::Upstream(msg),
            GoCaptchaError::Timeout => Self::Upstream("captcha service timeout".to_string()),
        }
    }
}

pub fn client_ip_from_request(req: &actix_web::HttpRequest) -> String {
    crate::utils::client_ip::from_http_request(req, false)
}
