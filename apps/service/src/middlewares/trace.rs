//! W3C Trace Context（`traceparent`）—— 跨进程链路标识
//!
//! 契约约定：所有跨进程端点都接受并回显 `traceparent`；响应信封的 `traceID` 取自本
//! 中间件，入口日志同样记录它。于是用户只要提供一个 `traceID`，就能把「客户端反馈 →
//! 本服务访问日志 → 下游调用」串成一条链路。
//!
//! 开启 OTel（`telemetry.enabled`）后，本进程的 `trace_id` / `span_id` 改由 server span
//! 生成，上游 `traceparent` 作为它的父 span —— 于是导出的链路与日志、响应信封、出站
//! `traceparent` 完全对齐。关闭时全部走本模块的内置实现，行为不变。

use std::rc::Rc;

use actix_web::{
    Error, HttpMessage,
    body::MessageBody,
    dev::{Service, ServiceRequest, ServiceResponse, Transform, forward_ready},
    http::{
        StatusCode,
        header::{HeaderName, HeaderValue},
    },
};
use futures::future::{LocalBoxFuture, Ready, ok};
use opentelemetry::{
    Context as OtelContext,
    trace::{Status as SpanStatus, TraceContextExt},
};
use rand::Rng;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::utils::telemetry;

/// W3C Trace Context 请求 / 响应头
pub const TRACEPARENT: &str = "traceparent";

/// `traceparent` version 段
const VERSION: &str = "00";
/// `traceparent` flags 段的 sampled 位
const FLAG_SAMPLED: u8 = 0x01;

tokio::task_local! {
    static CURRENT: TraceContext;
}

/// 单次请求的链路上下文
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceContext {
    /// 32 位十六进制，全链路唯一
    pub trace_id: String,
    /// 16 位十六进制，本进程本次请求的 span
    pub span_id: String,
    /// 上游 span（无上游调用时为空）
    pub parent_span_id: Option<String>,
    /// 上游的采样决定；无上游时默认采样
    pub sampled: bool,
}

impl TraceContext {
    /// 无上游链路时新建根上下文
    pub fn new_root() -> Self {
        Self {
            trace_id: random_hex::<16>(),
            span_id: random_hex::<8>(),
            parent_span_id: None,
            sampled: true,
        }
    }

    /// 解析上游 `traceparent`；格式非法或全零标识一律返回 `None`，由调用方新建根上下文
    pub fn parse(value: &str) -> Option<Self> {
        let mut parts = value.trim().split('-');
        let version = parts.next()?;
        let trace_id = parts.next()?;
        let parent_span_id = parts.next()?;
        let flags = parts.next()?;

        if !is_valid_segment(version, 2) || version.eq_ignore_ascii_case("ff") {
            return None;
        }
        // 低版本不允许追加字段；高版本允许携带未来扩展，故只校验前四段
        if version == VERSION && parts.next().is_some() {
            return None;
        }
        if !is_valid_segment(trace_id, 32) || is_all_zero(trace_id) {
            return None;
        }
        if !is_valid_segment(parent_span_id, 16) || is_all_zero(parent_span_id) {
            return None;
        }
        if !is_valid_segment(flags, 2) {
            return None;
        }

        let sampled = u8::from_str_radix(flags, 16).ok()? & FLAG_SAMPLED != 0;

        Some(Self {
            trace_id: trace_id.to_ascii_lowercase(),
            span_id: random_hex::<8>(),
            parent_span_id: Some(parent_span_id.to_ascii_lowercase()),
            sampled,
        })
    }

    /// 从请求头解析，缺失或非法时新建根上下文
    pub fn from_header(value: Option<&HeaderValue>) -> Self {
        value
            .and_then(|value| value.to_str().ok())
            .and_then(Self::parse)
            .unwrap_or_else(Self::new_root)
    }

    /// 回写 / 向下游转发的 `traceparent`（携带本进程 span）
    pub fn to_traceparent(&self) -> String {
        format!(
            "{VERSION}-{}-{}-{:02x}",
            self.trace_id,
            self.span_id,
            if self.sampled { FLAG_SAMPLED } else { 0 }
        )
    }
}

/// 当前任务的链路上下文；不在 HTTP 请求内（单测、后台任务）返回 `None`
pub fn current() -> Option<TraceContext> {
    CURRENT.try_with(TraceContext::clone).ok()
}

/// 当前任务的 `trace_id`，供响应信封与日志使用
pub fn current_trace_id() -> Option<String> {
    current().map(|ctx| ctx.trace_id)
}

/// 在给定链路上下文中执行 future（后台任务可据此把工作挂到某条链路上）
pub async fn scoped<F: std::future::Future>(ctx: TraceContext, fut: F) -> F::Output {
    CURRENT.scope(ctx, fut).await
}

/// 链路中间件：解析 / 新建 trace 上下文，放入请求扩展与任务作用域，并回显 `traceparent`
pub struct Trace;

impl<S, B> Transform<S, ServiceRequest> for Trace
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = TraceMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(TraceMiddleware {
            service: Rc::new(service),
        })
    }
}

pub struct TraceMiddleware<S> {
    service: Rc<S>,
}

impl<S, B> Service<ServiceRequest> for TraceMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: MessageBody + 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    forward_ready!(service);

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let service = Rc::clone(&self.service);
        // 上游链路：OTel 关闭时它就是全部依据；开启时还是 server span 的父 span
        let upstream = TraceContext::from_header(req.headers().get(TRACEPARENT));

        let span = telemetry::is_enabled().then(|| server_span(&req));
        if let Some(span) = &span {
            if let Some(remote) = telemetry::extract_parent(req.headers()) {
                // 必须在 span 建成之前设置；这里紧接着创建，失败只会是层缺失
                let _ = span.set_parent(OtelContext::new().with_remote_span_context(remote));
            }
        }

        // OTel 开启时用它生成的标识覆盖内置标识，保证日志 / 信封 / 出站头 / 导出 span 同源
        let mut ctx = upstream;
        if let Some(w3c) = span.as_ref().and_then(telemetry::span_w3c) {
            ctx.trace_id = w3c.trace_id;
            ctx.span_id = w3c.span_id;
            ctx.sampled = w3c.sampled;
        }
        let traceparent = ctx.to_traceparent();

        req.extensions_mut().insert(ctx.clone());

        Box::pin(async move {
            let call = service.call(req);
            let result = match &span {
                Some(span) => CURRENT.scope(ctx, call.instrument(span.clone())).await,
                None => CURRENT.scope(ctx, call).await,
            };
            let mut res = result?;

            if let Some(span) = &span {
                record_status(span, res.status());
            }
            if let Ok(value) = HeaderValue::from_str(&traceparent) {
                res.headers_mut()
                    .insert(HeaderName::from_static(TRACEPARENT), value);
            }
            Ok(res)
        })
    }
}

/// 本进程的 server span：`otel.name` 给后端一个好读的名字，方法与路径按语义约定落属性
fn server_span(req: &ServiceRequest) -> tracing::Span {
    let method = req.method().as_str();
    let path = req.path();
    tracing::info_span!(
        "http.request",
        "otel.kind" = "server",
        "otel.name" = %format!("{method} {path}"),
        "http.request.method" = %method,
        "url.path" = %path,
    )
}

/// 响应状态落回 span：5xx 记为错误（服务端故障），4xx 只作属性（客户端问题）
fn record_status(span: &tracing::Span, status: StatusCode) {
    span.set_attribute("http.response.status_code", i64::from(status.as_u16()));
    if status.is_server_error() {
        span.set_status(SpanStatus::error(
            status.canonical_reason().unwrap_or("server error"),
        ));
    }
}

fn is_valid_segment(segment: &str, len: usize) -> bool {
    segment.len() == len && segment.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_all_zero(segment: &str) -> bool {
    segment.bytes().all(|b| b == b'0')
}

fn random_hex<const N: usize>() -> String {
    let mut buf = [0u8; N];
    rand::rng().fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{App, HttpResponse, test as awtest, web};
    use opentelemetry::propagation::TextMapPropagator;
    use opentelemetry::trace::{SpanId, SpanKind, TraceId, TracerProvider};
    use opentelemetry_sdk::{
        propagation::TraceContextPropagator,
        trace::{Sampler, SdkTracerProvider, SpanData},
    };
    use std::collections::HashMap;
    use tracing_subscriber::layer::SubscriberExt;

    const UPSTREAM: &str = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const UPSTREAM_TRACE_ID: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
    const UPSTREAM_SPAN_ID: &str = "00f067aa0ba902b7";

    #[test]
    fn parses_valid_upstream_context() {
        let ctx = TraceContext::parse(UPSTREAM).expect("应解析成功");
        assert_eq!(ctx.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");
        assert_eq!(ctx.parent_span_id.as_deref(), Some("00f067aa0ba902b7"));
        assert!(ctx.sampled);
        // 本进程 span 必须是新生成的 16 位十六进制
        assert_ne!(ctx.span_id, "00f067aa0ba902b7");
        assert!(is_valid_segment(&ctx.span_id, 16));
    }

    #[test]
    fn inherits_unsampled_flag() {
        let ctx = TraceContext::parse("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00")
            .expect("应解析成功");
        assert!(!ctx.sampled);
        assert!(ctx.to_traceparent().ends_with("-00"));
    }

    #[test]
    fn tolerates_tracestate_extension_of_future_versions() {
        let value = "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra";
        assert!(TraceContext::parse(value).is_some());
    }

    #[test]
    fn rejects_malformed_context() {
        for bad in [
            "",
            "00",
            "00--00f067aa0ba902b7-01",
            // trace_id 全零
            "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
            // parent_id 全零
            "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
            // 长度不对
            "00-4bf92f3577b34da6a3ce929d0e0e47-00f067aa0ba902b7-01",
            // 非十六进制
            "00-4bf92f3577b34da6a3ce929d0e0e473g-00f067aa0ba902b7-01",
            // 非法 version
            "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            // 00 版本不允许追加字段
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra",
        ] {
            assert!(
                TraceContext::parse(bad).is_none(),
                "{bad} 应被判定为非法 traceparent"
            );
        }
    }

    #[test]
    fn new_root_is_well_formed() {
        let ctx = TraceContext::new_root();
        assert!(is_valid_segment(&ctx.trace_id, 32));
        assert!(is_valid_segment(&ctx.span_id, 16));
        assert!(!is_all_zero(&ctx.trace_id));
        assert!(
            ctx.to_traceparent()
                .starts_with(&format!("00-{}-", ctx.trace_id))
        );

        let other = TraceContext::new_root();
        assert_ne!(ctx.trace_id, other.trace_id);
    }

    async fn echo_trace_id() -> HttpResponse {
        HttpResponse::Ok().body(current_trace_id().unwrap_or_else(|| "-".to_string()))
    }

    #[actix_web::test]
    async fn middleware_propagates_and_echoes_context() {
        let app = awtest::init_service(
            App::new()
                .wrap(Trace)
                .route("/x", web::get().to(echo_trace_id)),
        )
        .await;

        let req = awtest::TestRequest::get()
            .uri("/x")
            .insert_header((TRACEPARENT, UPSTREAM))
            .to_request();
        let resp = awtest::call_service(&app, req).await;

        let header = resp
            .headers()
            .get(TRACEPARENT)
            .expect("响应必须回显 traceparent")
            .to_str()
            .expect("traceparent 必须是可见字符")
            .to_string();
        let echoed = TraceContext::parse(&header).expect("回显的 traceparent 必须合法");
        assert_eq!(echoed.trace_id, "4bf92f3577b34da6a3ce929d0e0e4736");

        let body = awtest::read_body(resp).await;
        let body = std::str::from_utf8(&body).expect("body 是 utf-8");
        assert_eq!(
            body, echoed.trace_id,
            "handler 里取到的 trace_id 必须与回显一致"
        );
    }

    #[actix_web::test]
    async fn middleware_creates_context_without_upstream() {
        let app = awtest::init_service(
            App::new()
                .wrap(Trace)
                .route("/x", web::get().to(echo_trace_id)),
        )
        .await;

        let req = awtest::TestRequest::get().uri("/x").to_request();
        let resp = awtest::call_service(&app, req).await;

        let header = resp
            .headers()
            .get(TRACEPARENT)
            .expect("无上游也必须生成 traceparent")
            .to_str()
            .expect("traceparent 必须是可见字符")
            .to_string();
        let ctx = TraceContext::parse(&header).expect("自建的 traceparent 必须合法");
        let body = awtest::read_body(resp).await;
        assert_eq!(std::str::from_utf8(&body).unwrap(), ctx.trace_id);
        assert!(is_valid_segment(&ctx.span_id, 16));
    }

    #[test]
    fn context_is_absent_outside_request_scope() {
        assert!(current().is_none());
        assert!(current_trace_id().is_none());
    }

    /// 在只对本测试生效的订阅者里跑 `body`：span 收进内存导出器，不碰全局状态也不发网络。
    fn with_otel(body: impl FnOnce()) -> Vec<SpanData> {
        let (exporter, mut exported, _shutdown) =
            opentelemetry_sdk::testing::trace::new_test_exporter();
        let provider = SdkTracerProvider::builder()
            .with_simple_exporter(exporter)
            .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                1.0,
            ))))
            .build();
        let subscriber = tracing_subscriber::registry()
            .with(tracing_opentelemetry::layer().with_tracer(provider.tracer("test")));

        tracing::subscriber::with_default(subscriber, body);
        provider.force_flush().expect("刷干应成功");

        let mut spans = Vec::new();
        while let Ok(data) = exported.try_recv() {
            spans.push(data);
        }
        spans
    }

    /// 造一个与中间件同源的 server span；顺带校验父 span 与本进程标识都取自上游 traceparent。
    fn start_request(uri: &str) -> tracing::Span {
        let mut carrier = HashMap::new();
        carrier.insert(TRACEPARENT.to_string(), UPSTREAM.to_string());
        let remote = TraceContextPropagator::new()
            .extract(&carrier)
            .span()
            .span_context()
            .clone();

        let request = awtest::TestRequest::get().uri(uri).to_srv_request();
        let span = server_span(&request);
        span.set_parent(OtelContext::new().with_remote_span_context(remote))
            .expect("层已就位，应能设置父 span");

        let w3c = telemetry::span_w3c(&span).expect("server span 必须有效");
        assert_eq!(w3c.trace_id, UPSTREAM_TRACE_ID);
        assert_ne!(w3c.span_id, UPSTREAM_SPAN_ID, "本进程要自己取号");
        assert!(w3c.sampled);

        // 活跃 span 内出站头取真实上下文（与导出数据同源）
        span.in_scope(|| {
            assert_eq!(
                telemetry::current_traceparent().expect("活跃 span 应有上下文"),
                format!("00-{}-{}-01", w3c.trace_id, w3c.span_id)
            );
        });
        span
    }

    /// 属性是追加写，同名属性只应出现一次
    fn attribute(data: &SpanData, key: &str) -> Option<String> {
        let mut found = data
            .attributes
            .iter()
            .filter(|kv| kv.key.as_str() == key)
            .map(|kv| kv.value.as_str().into_owned());
        let value = found.next();
        assert!(found.next().is_none(), "{key} 不应重复");
        value
    }

    /// OTel 开启时中间件的取号方式：上游 traceparent 成为 server span 的父 span，语义约定落成属性
    #[test]
    fn server_span_inherits_upstream_traceparent() {
        let spans = with_otel(|| {
            record_status(&start_request("/x"), StatusCode::OK);
        });

        assert_eq!(spans.len(), 1, "每个请求应恰好导出一个 span");
        let data = &spans[0];
        assert_eq!(data.name, "GET /x");
        assert_eq!(data.span_kind, SpanKind::Server);
        assert_eq!(
            data.parent_span_id,
            SpanId::from_hex(UPSTREAM_SPAN_ID).expect("合法 span_id")
        );
        assert_eq!(
            data.span_context.trace_id(),
            TraceId::from_hex(UPSTREAM_TRACE_ID).expect("合法 trace_id")
        );
        assert!(data.span_context.is_sampled());
        assert_eq!(
            attribute(data, "http.request.method").as_deref(),
            Some("GET")
        );
        assert_eq!(attribute(data, "url.path").as_deref(), Some("/x"));
        assert_eq!(
            attribute(data, "http.response.status_code").as_deref(),
            Some("200")
        );
        assert_eq!(data.status, SpanStatus::Unset, "2xx 不算失败");
    }

    /// 只有服务端故障才算失败：客户端错误照实记状态码，但不改 span 状态
    #[test]
    fn record_status_marks_only_server_faults_as_error() {
        let spans = with_otel(|| {
            record_status(&start_request("/missing"), StatusCode::NOT_FOUND);
            record_status(&start_request("/boom"), StatusCode::INTERNAL_SERVER_ERROR);
        });

        assert_eq!(spans.len(), 2);
        assert_eq!(
            attribute(&spans[0], "http.response.status_code").as_deref(),
            Some("404")
        );
        assert_eq!(spans[0].status, SpanStatus::Unset, "4xx 是客户端问题");
        assert_eq!(
            attribute(&spans[1], "http.response.status_code").as_deref(),
            Some("500")
        );
        assert_eq!(spans[1].status, SpanStatus::error("Internal Server Error"));
    }
}
