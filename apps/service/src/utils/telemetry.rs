//! 链路追踪（OTel）：资源、采样、OTLP 导出与 W3C 传播。
//!
//! 关闭时（`telemetry.enabled = false`，默认）本模块不注册任何全局状态：`tracing` 里没有
//! OTel 层，`tracing::Span::context()` 永远是无效上下文，于是请求入口原样退回内置的 W3C
//! 实现（见 [`crate::middlewares::trace`]），行为与接入前完全一致。

use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use actix_web::http::header::HeaderMap;
use anyhow::{Context, Result};
use opentelemetry::{
    KeyValue, global,
    propagation::{Extractor, TextMapPropagator},
    trace::{SpanContext, TraceContextExt, TracerProvider},
};
use opentelemetry_otlp::{SpanExporter, WithExportConfig};
use opentelemetry_sdk::{
    Resource,
    propagation::TraceContextPropagator,
    trace::{Sampler, SdkTracer, SdkTracerProvider},
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::configures::configure::Configure;

/// `traceparent` 版本段（W3C，与内置实现同源）
const VERSION: &str = "00";
/// `endpoint` 只给基址时补上的 OTLP/HTTP traces 路径
const TRACES_PATH: &str = "/v1/traces";
/// 资源里的 `service.version`
const SERVICE_VERSION: &str = env!("CARGO_PKG_VERSION");

static ENABLED: AtomicBool = AtomicBool::new(false);

/// 链路追踪是否已启用（决定请求入口是否建 OTel span）
pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// 已启用的链路追踪：持有 provider（用于刷干 / 停机）与 instrumentation scope 名
pub struct Telemetry {
    provider: SdkTracerProvider,
    scope: String,
}

impl Telemetry {
    /// 供 `tracing-opentelemetry` 层使用的 tracer
    pub fn tracer(&self) -> SdkTracer {
        self.provider.tracer(self.scope.clone())
    }

    /// 刷干缓冲并停机（进程退出前调用；之后再产生的 span 不会被导出）
    pub fn shutdown(&self) {
        if let Err(error) = self.provider.force_flush() {
            tracing::warn!(error = %error, "链路刷干失败");
        }
        if let Err(error) = self.provider.shutdown() {
            tracing::warn!(error = %error, "链路停机失败");
        }
    }
}

/// 初始化链路追踪，返回可交给 `logger::init` 的句柄；未开启时返回 `None` 且不留全局状态。
///
/// `role` 是进程角色（`api` / `worker` / `orchestrator`），用于区分同一份配置下的多个进程。
pub fn init(configure: &Configure, role: &str) -> Result<Option<Telemetry>> {
    let telemetry = &configure.telemetry;
    if !telemetry.enabled {
        return Ok(None);
    }

    let scope = service_name(&telemetry.service_name, role);

    // 注意：导出由 `with_batch_exporter` 的**独立线程**驱动，那里没有 Tokio reactor，
    // 所以只能配 `reqwest-blocking-client`（见 Cargo.toml）。用异步客户端会在首个导出时
    // panic（no reactor running），批处理器线程随之死掉，所有 span 静默丢失。
    let exporter = SpanExporter::builder()
        .with_http()
        .with_endpoint(traces_endpoint(&telemetry.endpoint))
        .with_timeout(Duration::from_millis(telemetry.timeout_ms))
        .build()
        .context("Failed to build OTLP span exporter")?;

    let resource = Resource::builder()
        .with_service_name(scope.clone())
        .with_attributes([
            KeyValue::new("service.version", SERVICE_VERSION),
            KeyValue::new("deployment.environment.name", configure.app.env.clone()),
        ])
        .build();

    let provider = SdkTracerProvider::builder()
        .with_resource(resource)
        .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
            telemetry.sample_ratio,
        ))))
        .with_batch_exporter(exporter)
        .build();

    // 入站抽取与出站注入都用 W3C TraceContext：headers 里的 traceparent 即唯一真相
    global::set_text_map_propagator(TraceContextPropagator::new());
    global::set_tracer_provider(provider.clone());
    ENABLED.store(true, Ordering::Relaxed);

    Ok(Some(Telemetry { provider, scope }))
}

/// 请求头里的上游 span 上下文；没有全局传播器或头非法时为 `None`
pub fn extract_parent(headers: &HeaderMap) -> Option<SpanContext> {
    global::get_text_map_propagator(|propagator| extract_with(propagator, headers))
}

/// OTel span 上下文里的 `traceparent` 三要素（刻意不暴露 OTel 类型给中间件）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct W3c {
    /// 32 位十六进制
    pub trace_id: String,
    /// 16 位十六进制
    pub span_id: String,
    /// 采样决定
    pub sampled: bool,
}

/// 某个 `tracing::Span` 对应的 OTel `SpanContext` → W3C 三要素；未接 OTel 或上下文无效时
/// 为 `None`（调用方据此退回内置实现）
pub fn span_w3c(span: &tracing::Span) -> Option<W3c> {
    w3c_of(&span.context().span().span_context().clone())
}

/// 当前 span 的 `traceparent`（出站转发用）；未接 OTel 或不在 span 内时为 `None`
pub fn current_traceparent() -> Option<String> {
    let span = tracing::Span::current();
    let w3c = span_w3c(&span)?;
    Some(format!(
        "{VERSION}-{}-{}-{:02x}",
        w3c.trace_id,
        w3c.span_id,
        if w3c.sampled { 0x01 } else { 0x00 }
    ))
}

/// 资源里的 `service.name`：`{前缀}-{角色}`；前缀留空则只用角色
fn service_name(prefix: &str, role: &str) -> String {
    let prefix = prefix.trim();
    if prefix.is_empty() {
        role.to_string()
    } else {
        format!("{prefix}-{role}")
    }
}

/// `endpoint` 只给基址时补 `/v1/traces`；已带路径则按原样使用（OTLP/HTTP 的约定）
fn traces_endpoint(endpoint: &str) -> String {
    let endpoint = endpoint.trim().trim_end_matches('/');
    match endpoint.split_once("://") {
        Some((_, rest)) if !rest.contains('/') => format!("{endpoint}{TRACES_PATH}"),
        Some(_) => endpoint.to_string(),
        // 没有 scheme：交给导出器报错，别在这里瞎补路径
        None => endpoint.to_string(),
    }
}

fn extract_with(propagator: &dyn TextMapPropagator, headers: &HeaderMap) -> Option<SpanContext> {
    let context = propagator.extract(&HeaderExtractor(headers));
    let span_context = context.span().span_context().clone();
    span_context.is_valid().then_some(span_context)
}

fn w3c_of(span_context: &SpanContext) -> Option<W3c> {
    if !span_context.is_valid() {
        return None;
    }
    Some(W3c {
        trace_id: format!(
            "{:032x}",
            u128::from_be_bytes(span_context.trace_id().to_bytes())
        ),
        span_id: format!(
            "{:016x}",
            u64::from_be_bytes(span_context.span_id().to_bytes())
        ),
        sampled: span_context.is_sampled(),
    })
}

/// 把 actix 的请求头喂给 OTel 传播器
struct HeaderExtractor<'a>(&'a HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|key| key.as_str()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::http::header::{HeaderName, HeaderValue};
    use opentelemetry::trace::{SpanId, TraceFlags, TraceId, TraceState};

    const TRACEPARENT: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    fn headers(value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("traceparent"),
            HeaderValue::from_str(value).expect("合法头"),
        );
        headers
    }

    fn make_span_context(trace_id: &str, span_id: &str, sampled: bool) -> SpanContext {
        SpanContext::new(
            TraceId::from_hex(trace_id).expect("合法 trace_id"),
            SpanId::from_hex(span_id).expect("合法 span_id"),
            if sampled {
                TraceFlags::SAMPLED
            } else {
                TraceFlags::default()
            },
            true,
            TraceState::default(),
        )
    }

    #[test]
    fn traces_endpoint_appends_default_path_when_base_url() {
        assert_eq!(
            traces_endpoint("http://127.0.0.1:4318"),
            "http://127.0.0.1:4318/v1/traces"
        );
        assert_eq!(
            traces_endpoint("  http://collector:4318/  "),
            "http://collector:4318/v1/traces"
        );
    }

    #[test]
    fn traces_endpoint_keeps_explicit_path() {
        let explicit = "http://collector:4318/otlp/v1/traces";
        assert_eq!(traces_endpoint(explicit), explicit);
        // 没写 scheme 时不猜路径：让导出器报错，而不是发到一个看似合理的地址
        assert_eq!(traces_endpoint("collector:4318"), "collector:4318");
    }

    #[test]
    fn service_name_combines_prefix_with_role() {
        assert_eq!(
            service_name("cogito", "service"),
            "cogito-service"
        );
        assert_eq!(service_name("  ", "worker"), "worker");
        assert_eq!(
            service_name(" cogito ", "orchestrator"),
            "cogito-orchestrator"
        );
    }

    #[test]
    fn w3c_of_formats_ids_and_sampling() {
        let context =
            make_span_context("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", true);
        let w3c = w3c_of(&context).expect("有效上下文");
        assert_eq!(w3c.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(w3c.span_id, "00f067aa0ba902b7");
        assert!(w3c.sampled);
        let unsampled = make_span_context(
            "4bf92f3577b34da6a3ce929d0e0e4736",
            "00f067aa0ba902b7",
            false,
        );
        assert!(!w3c_of(&unsampled).expect("有效上下文").sampled);
    }

    #[test]
    fn w3c_of_rejects_invalid_span_context() {
        let invalid = SpanContext::new(
            TraceId::INVALID,
            SpanId::INVALID,
            TraceFlags::default(),
            false,
            TraceState::default(),
        );
        assert!(w3c_of(&invalid).is_none());
    }

    #[test]
    fn extract_with_reads_traceparent() {
        let propagator = TraceContextPropagator::new();
        let extracted = extract_with(&propagator, &headers(TRACEPARENT)).expect("应抽取到上下文");
        assert_eq!(
            format!(
                "{:032x}",
                u128::from_be_bytes(extracted.trace_id().to_bytes())
            ),
            "4bf92f3577b34da6a3ce929d0e0e4736"
        );
        assert_eq!(
            format!(
                "{:016x}",
                u64::from_be_bytes(extracted.span_id().to_bytes())
            ),
            "00f067aa0ba902b7"
        );
        assert!(extracted.is_sampled());
    }

    #[test]
    fn extract_with_ignores_malformed_headers() {
        let propagator = TraceContextPropagator::new();
        for bad in [
            "",
            "00",
            // trace_id 全零
            "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
            // 不是 traceparent
            "not-a-traceparent",
        ] {
            assert!(
                extract_with(&propagator, &headers(bad)).is_none(),
                "{bad} 不应抽出上下文"
            );
        }
        // 头缺失
        assert!(extract_with(&propagator, &HeaderMap::new()).is_none());
    }

    /// 没有 OTel 层时 `Span::context()` 不是有效上下文 —— 这条契约是「关闭时行为不变」的前提
    #[test]
    fn span_w3c_and_current_traceparent_are_none_without_otel_layer() {
        assert!(span_w3c(&tracing::Span::none()).is_none());
        assert!(span_w3c(&tracing::info_span!("unit-test")).is_none());
        assert!(current_traceparent().is_none());
    }

    /// 默认关闭：`init` 是纯粹的「什么都不做」，不装传播器也不装 provider
    #[test]
    fn init_is_inert_when_disabled() {
        let configure = Configure::default();
        assert!(!configure.telemetry.enabled);

        let telemetry = init(&configure, "api").expect("关闭时必须成功返回");
        assert!(telemetry.is_none());
        assert!(!is_enabled());
        assert!(
            extract_parent(&headers(TRACEPARENT)).is_none(),
            "关闭时不应注册全局传播器：抽取交给内置实现"
        );
    }
}
