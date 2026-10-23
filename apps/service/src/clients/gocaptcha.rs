//! go-captcha-service HTTP 客户端（get-data / check-data）。

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::configures::configure::Configure;

const GET_DATA_PATH: &str = "/api/v1/public/get-data";
const CHECK_DATA_PATH: &str = "/api/v1/public/check-data";

#[derive(Debug, Clone)]
pub struct CaptchaChallenge {
    pub kind: String,
    pub captcha_key: String,
    pub master_image: String,
    pub thumb_image: String,
    pub thumb_x: i32,
    pub thumb_y: i32,
    pub thumb_width: i32,
    pub thumb_height: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum GoCaptchaError {
    #[error("Captcha rate limited")]
    RateLimited,
    #[error("Invalid captcha")]
    Invalid,
    #[error("Captcha expired")]
    Expired,
    #[error("Captcha upstream error: {0}")]
    Upstream(String),
    #[error("Captcha service timeout")]
    Timeout,
    #[error("Cache error: {0}")]
    Cache(String),
}

#[derive(Clone)]
pub struct GoCaptchaClient {
    http: Client,
    base_url: String,
    api_key: String,
    default_kind: String,
}

impl GoCaptchaClient {
    pub fn new(config: &Configure) -> Result<Self> {
        let timeout = Duration::from_millis(config.captcha_timeout_ms());
        // 本地侧车直连（127.0.0.1:8080）：禁用代理，否则请求会被本机系统代理
        // （如 127.0.0.1:7892）拦截并返回 502。仅作用于本客户端。
        let http = Client::builder()
            .timeout(timeout)
            .no_proxy()
            .build()
            .context("failed to build go-captcha http client")?;

        Ok(Self {
            http,
            base_url: trim_trailing_slash(config.captcha_base_url()),
            api_key: config.captcha_api_key().to_string(),
            default_kind: config.captcha_kind().to_string(),
        })
    }

    pub fn resolve_kind(&self, kind: Option<&str>) -> String {
        kind.filter(|k| !k.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| self.default_kind.clone())
    }

    pub async fn get_data(&self, kind: &str) -> Result<CaptchaChallenge, GoCaptchaError> {
        let url = format!("{}{}", self.base_url, GET_DATA_PATH);
        let response = self
            .http
            .get(&url)
            .header("X-API-Key", &self.api_key)
            .query(&[("id", kind)])
            .send()
            .await
            .map_err(map_reqwest_error)?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| GoCaptchaError::Upstream(e.to_string()))?;

        if !status.is_success() {
            return Err(GoCaptchaError::Upstream(format!(
                "get-data status {}: {}",
                status.as_u16(),
                truncate(&body, 256)
            )));
        }

        let parsed: GetDataResponse = serde_json::from_str(&body).map_err(|e| {
            GoCaptchaError::Upstream(format!("get-data json: {e}; body={}", truncate(&body, 256)))
        })?;

        if parsed.code != 0 && parsed.code != 200 {
            return Err(GoCaptchaError::Upstream(format!(
                "get-data code {}: {}",
                parsed.code,
                parsed.message.unwrap_or_default()
            )));
        }

        let payload = parsed
            .data
            .ok_or_else(|| GoCaptchaError::Upstream("get-data missing data payload".to_string()))?;

        let captcha_key = payload.captcha_key();
        if captcha_key.is_empty() {
            return Err(GoCaptchaError::Upstream(
                "get-data missing captchaKey".to_string(),
            ));
        }

        let master_image = payload.master_image();
        let thumb_image = payload.thumb_image();
        if master_image.is_empty() || thumb_image.is_empty() {
            return Err(GoCaptchaError::Upstream(
                "get-data missing image base64".to_string(),
            ));
        }

        Ok(CaptchaChallenge {
            kind: payload.kind().unwrap_or_else(|| kind.to_string()),
            captcha_key,
            master_image,
            thumb_image,
            thumb_x: payload.display_x(),
            thumb_y: payload.display_y(),
            thumb_width: payload.thumb_width(),
            thumb_height: payload.thumb_height(),
        })
    }

    pub async fn check_data(
        &self,
        kind: &str,
        captcha_key: &str,
        value: &str,
    ) -> Result<(), GoCaptchaError> {
        let url = format!("{}{}", self.base_url, CHECK_DATA_PATH);
        let payload = CheckDataRequest {
            id: kind.to_string(),
            captcha_key: captcha_key.to_string(),
            value: value.to_string(),
        };

        let response = self
            .http
            .post(&url)
            .header("X-API-Key", &self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| GoCaptchaError::Upstream(e.to_string()))?;

        if !status.is_success() {
            return Err(GoCaptchaError::Upstream(format!(
                "check-data status {}: {}",
                status.as_u16(),
                truncate(&body, 256)
            )));
        }

        let parsed: CheckDataResponse = serde_json::from_str(&body).map_err(|e| {
            GoCaptchaError::Upstream(format!(
                "check-data json: {e}; body={}",
                truncate(&body, 256)
            ))
        })?;

        if parsed.code != 0 && parsed.code != 200 {
            return Err(map_check_failure(&parsed));
        }

        let ok = parsed
            .data
            .as_deref()
            .is_some_and(|d| d.eq_ignore_ascii_case("ok"));

        if ok {
            Ok(())
        } else {
            Err(map_check_failure(&parsed))
        }
    }
}

#[derive(Debug, Deserialize)]
struct GetDataResponse {
    code: i32,
    message: Option<String>,
    data: Option<GetDataPayload>,
}

#[derive(Debug, Deserialize)]
struct GetDataPayload {
    id: Option<String>,
    captcha_key: Option<String>,
    master_image_base64: Option<String>,
    thumb_image_base64: Option<String>,
    display_x: Option<i32>,
    display_y: Option<i32>,
    thumb_width: Option<i32>,
    thumb_height: Option<i32>,
}

impl GetDataPayload {
    fn kind(&self) -> Option<String> {
        self.id.as_ref().filter(|s| !s.is_empty()).cloned()
    }

    fn captcha_key(&self) -> String {
        non_empty(self.captcha_key.as_deref()).unwrap_or_default()
    }

    fn master_image(&self) -> String {
        non_empty(self.master_image_base64.as_deref()).unwrap_or_default()
    }

    fn thumb_image(&self) -> String {
        non_empty(self.thumb_image_base64.as_deref()).unwrap_or_default()
    }

    fn display_x(&self) -> i32 {
        self.display_x.unwrap_or(0)
    }

    fn display_y(&self) -> i32 {
        self.display_y.unwrap_or(0)
    }

    fn thumb_width(&self) -> i32 {
        self.thumb_width.unwrap_or(0)
    }

    fn thumb_height(&self) -> i32 {
        self.thumb_height.unwrap_or(0)
    }
}

fn non_empty(value: Option<&str>) -> Option<String> {
    value.filter(|s| !s.is_empty()).map(str::to_string)
}

#[derive(Debug, Serialize)]
struct CheckDataRequest {
    id: String,
    #[serde(rename = "captchaKey")]
    captcha_key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct CheckDataResponse {
    code: i32,
    message: Option<String>,
    data: Option<String>,
}

fn map_reqwest_error(err: reqwest::Error) -> GoCaptchaError {
    if err.is_timeout() {
        GoCaptchaError::Timeout
    } else {
        GoCaptchaError::Upstream(err.to_string())
    }
}

fn map_check_failure(resp: &CheckDataResponse) -> GoCaptchaError {
    let msg = resp
        .message
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if msg.contains("expire") {
        GoCaptchaError::Expired
    } else {
        GoCaptchaError::Invalid
    }
}

fn trim_trailing_slash(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        value.to_string()
    } else {
        format!("{}...", value[..max].to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_get_data_response() {
        let json = r#"{
            "code": 200,
            "message": "success",
            "data": {
                "id": "slide-default",
                "captcha_key": "key-1",
                "master_image_base64": "data:image/jpeg;base64,master",
                "thumb_image_base64": "data:image/png;base64,thumb",
                "display_x": 19,
                "display_y": 15,
                "thumb_width": 60,
                "thumb_height": 60
            }
        }"#;
        let parsed: GetDataResponse = serde_json::from_str(json).expect("parse");
        let payload = parsed.data.expect("data");
        assert_eq!(payload.captcha_key(), "key-1");
        assert_eq!(payload.display_x(), 19);
        assert_eq!(payload.display_y(), 15);
    }

    #[test]
    fn check_ok_when_data_ok() {
        let json = r#"{"code":200,"message":"ok","data":"ok"}"#;
        let parsed: CheckDataResponse = serde_json::from_str(json).expect("parse");
        assert!(
            parsed
                .data
                .as_deref()
                .is_some_and(|d| d.eq_ignore_ascii_case("ok"))
        );
    }
}
