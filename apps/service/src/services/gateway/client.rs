//! 上游 OpenAI 兼容供应商的流式 HTTP 客户端。

use std::time::Duration;

use reqwest::Client;

use crate::configures::configure::Configure;

#[derive(Debug, thiserror::Error)]
pub enum UpstreamError {
    #[error("upstream request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("upstream status {status}: {detail}")]
    Status { status: u16, detail: String },
    #[error("upstream returned a non-JSON body: {0}")]
    Body(String),
}

pub struct Upstream {
    http: Client,
}

impl Upstream {
    pub fn new(config: &Configure) -> Self {
        // 只设连接超时：流式响应可能长时间持续，不能用总超时掐断。
        // 供应商 baseUrl 由管理员显式配置（含 ollama/vLLM 等本机或内网上游），
        // 因此禁用 env 代理：否则本机系统代理（如 127.0.0.1:7892）会拦截请求并返回 502。
        let http = Client::builder()
            .connect_timeout(Duration::from_millis(config.gateway_upstream_timeout_ms()))
            .no_proxy()
            .build()
            .expect("failed to build gateway http client");
        Self { http }
    }

    /// POST `{base_url}/chat/completions`（OpenAI 兼容），成功返回流式响应。
    pub async fn post_chat(
        &self,
        url: &str,
        api_key: Option<&str>,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, UpstreamError> {
        let mut req = self.http.post(url).json(body);
        if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"));
        }
        let resp = req.send().await.map_err(|err| {
            tracing::error!(error = %err, url = %url, "gateway upstream request failed");
            UpstreamError::Http(err)
        })?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let detail = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status,
                url = %url,
                detail = %truncate(&detail, 500),
                "gateway upstream returned non-success status"
            );
            return Err(UpstreamError::Status {
                status,
                detail: truncate(&detail, 500),
            });
        }
        Ok(resp)
    }

    /// POST 一个非流式端点，成功后把响应体解成 JSON。
    ///
    /// 单独开一条路径而不是复用 [`post_chat`](Self::post_chat)：流式响应不能被整体读走
    /// （读走就等于把 SSE 缓冲成内存字符串，直传的意义全没了），而嵌入这类一次性调用
    /// 恰恰需要「读完 + 解析」。错误语义两边一致：非 2xx 是 [`UpstreamError::Status`]。
    pub async fn post_json(
        &self,
        url: &str,
        api_key: Option<&str>,
        body: &serde_json::Value,
    ) -> Result<serde_json::Value, UpstreamError> {
        let mut req = self.http.post(url).json(body);
        if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {}", key));
        }
        let resp = req.send().await.map_err(|err| {
            tracing::error!(error = %err, url = %url, "gateway upstream request failed");
            UpstreamError::Http(err)
        })?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let detail = resp.text().await.unwrap_or_default();
            tracing::warn!(
                status,
                url = %url,
                detail = %truncate(&detail, 500),
                "gateway upstream returned non-success status"
            );
            return Err(UpstreamError::Status {
                status,
                detail: truncate(&detail, 500),
            });
        }

        let text = resp.text().await.map_err(UpstreamError::Http)?;
        serde_json::from_str(&text).map_err(|err| {
            tracing::warn!(error = %err, url = %url, "gateway upstream body is not JSON");
            UpstreamError::Body(truncate(&text, 500))
        })
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}
