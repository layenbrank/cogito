//! 事件信封的派发终点：真的发 HTTP，或只记日志。
//!
//! 只做「一次投递」这一件事：重试、退避、置位由 `audit::Publisher` 决定。返回 `Ok(())`
//! 表示下游已接收，任何非 2xx 都算失败（事件留在 outbox 里等下一轮）。

use std::time::Duration;

use anyhow::{Context as _, Result};
use audit::{DispatchError, Dispatcher, Envelope};
use reqwest::Client;

use crate::configures::configure::{Configure, EventsConfig};

/// 失败响应体最多记多少字符（下游可能返回整页 HTML，日志不该被它淹没）。
const BODY_LIMIT: usize = 512;

/// 按配置选择终点：`events.endpoint` 为空就退化成只记日志。
pub enum WorkerDispatcher {
    Http(WebhookDispatcher),
    Logging,
}

impl WorkerDispatcher {
    /// 依据配置装配派发终点。
    ///
    /// # Errors
    ///
    /// HTTP 客户端构建失败（例如超时为零）时返回错误。
    pub fn from_configure(configure: &Configure) -> Result<Self> {
        let events = &configure.events;
        let Ok(endpoint) = validate_endpoint(&events.endpoint) else {
            return Ok(Self::Logging);
        };
        Ok(Self::Http(WebhookDispatcher::new(
            endpoint.to_owned(),
            events.token.clone(),
            build_client(events)?,
        )))
    }
}

/// 事件投递用的 HTTP 客户端：内网终点默认直连（与 `clients/` 下的内部客户端同策）。
///
/// # Errors
///
/// 客户端构建失败（例如超时为零）时返回错误。
fn build_client(events: &EventsConfig) -> Result<Client> {
    let mut builder = Client::builder().timeout(Duration::from_millis(events.timeout_ms));
    if !events.use_system_proxy {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .context("failed to build events http client")
}

impl Dispatcher for WorkerDispatcher {
    async fn dispatch(&self, envelope: &Envelope) -> Result<(), DispatchError> {
        match self {
            Self::Http(dispatcher) => dispatcher.dispatch(envelope).await,
            Self::Logging => {
                tracing::info!(
                    event_id = %envelope.id,
                    event_type = %envelope.event_type,
                    aggregate = %envelope.aggregate,
                    aggregate_id = %envelope.aggregate_id,
                    tenant_id = ?envelope.tenant_id,
                    "事件未投递（events.endpoint 未配置）：只记日志"
                );
                Ok(())
            }
        }
    }
}

/// 下游终点校验：只接受 http(s) 且必须带 host（`events.endpoint` 来自配置文件）。
fn validate_endpoint(endpoint: &str) -> Result<&str> {
    let endpoint = endpoint.trim();
    if endpoint.is_empty() {
        anyhow::bail!("events.endpoint 未配置");
    }
    let parsed = reqwest::Url::parse(endpoint).context("events.endpoint 不是合法的 URL")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        anyhow::bail!("events.endpoint 必须是带 host 的 http(s) URL");
    }
    Ok(endpoint)
}

/// 把事件信封 POST 给下游。
pub struct WebhookDispatcher {
    http: Client,
    endpoint: String,
    token: String,
}

impl WebhookDispatcher {
    pub fn new(endpoint: String, token: String, http: Client) -> Self {
        Self {
            http,
            endpoint,
            token,
        }
    }
}

impl Dispatcher for WebhookDispatcher {
    async fn dispatch(&self, envelope: &Envelope) -> Result<(), DispatchError> {
        let mut request = self.http.post(&self.endpoint).json(envelope);
        if !self.token.is_empty() {
            request = request.bearer_auth(&self.token);
        }
        // 把链路上下文透传下去：下游的日志能挂回同一个 trace
        if let Some(traceparent) = envelope.traceparent.as_deref() {
            request = request.header("traceparent", traceparent);
        }

        let response = request.send().await.map_err(|err| {
            DispatchError::Transport(format!("POST {} 失败：{err}", self.endpoint))
        })?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }

        let body = response.text().await.unwrap_or_default();
        Err(DispatchError::Status {
            status: status.as_u16(),
            body: truncate(&body, BODY_LIMIT),
        })
    }
}

/// 失败响应体截断到字符边界，避免日志被整页 HTML 淹没。
fn truncate(body: &str, limit: usize) -> String {
    let trimmed = body.trim();
    if trimmed.chars().count() <= limit {
        return trimmed.to_owned();
    }
    let mut out: String = trimmed.chars().take(limit).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_http_endpoints_for_in_cluster_downstreams() {
        for endpoint in [
            "http://compute:8000/internal/events",
            "https://a.example/e",
        ] {
            assert_eq!(validate_endpoint(endpoint).expect("合法"), endpoint);
        }
    }

    #[test]
    fn rejects_missing_or_hostless_endpoints() {
        for endpoint in [
            "",
            "   ",
            "compute:8000/events",
            "ftp://a.example/e",
            "http://",
        ] {
            assert!(validate_endpoint(endpoint).is_err(), "{endpoint} 应被拒");
        }
    }

    #[test]
    fn truncates_long_bodies_on_char_boundaries() {
        let body = "错".repeat(600);
        let cut = truncate(&body, BODY_LIMIT);
        assert_eq!(cut.chars().count(), BODY_LIMIT + 1, "截断后加省略号");
        assert!(truncate("短", BODY_LIMIT) == "短");
    }

    #[test]
    fn builds_a_client_for_both_proxy_policies() {
        for use_system_proxy in [false, true] {
            let events = EventsConfig {
                use_system_proxy,
                ..EventsConfig::default()
            };
            assert!(
                build_client(&events).is_ok(),
                "use_system_proxy={use_system_proxy}"
            );
        }
    }
}
