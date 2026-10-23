"""链路追踪：把本进程的 span 通过 OTLP/HTTP 送到 collector。

与 cogito 侧 `apps/service/src/utils/telemetry.rs` 是同一套约定：资源属性、采样策略、W3C 传播
都对得上，于是 cogito 发来的 `traceparent` 在这里成为 server span 的父 span，出站调用再往
下续 —— 一次跨语言调用在 Jaeger 里是一条 trace。

**默认关闭时本模块不留任何全局状态**：不建 provider、不建 exporter、不联网，请求入口原样
退回内置的 W3C 实现（见 [`compute.trace`]）。内置实现不是「备用方案」而是默认路径：
它保证没接 collector 的部署行为与接入前一模一样。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator, MutableMapping
from contextlib import asynccontextmanager, contextmanager
from http import HTTPStatus

from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import (
    NonRecordingSpan,
    Span,
    SpanContext,
    SpanKind,
    Status,
    StatusCode,
    TraceFlags,
    Tracer,
    set_span_in_context,
    use_span,
)
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from compute import trace
from compute.config import Settings

logger = logging.getLogger(__name__)

TRACES_PATH = "/v1/traces"
#: 传播器实例无状态，进程内复用即可（不写全局 `textmap`：那是 OTel 的单例，测试里收不回来）。
_PROPAGATOR = TraceContextTextMapPropagator()

_provider: TracerProvider | None = None
_tracer: Tracer | None = None


def is_enabled() -> bool:
    """是否已接 OTel。关闭时所有入口都走内置实现。"""
    return _tracer is not None


def traces_endpoint(endpoint: str) -> str:
    """`endpoint` 只给基址时补 `/v1/traces`；已带路径按原样使用（OTLP/HTTP 的约定）。

    与 `telemetry.rs` 的 `traces_endpoint` 同规则：没有 scheme 时不猜路径，交给导出器报错。
    """
    base = endpoint.strip().rstrip("/")
    _, separator, rest = base.partition("://")
    if not separator or "/" in rest:
        return base
    return f"{base}{TRACES_PATH}"


def setup(settings: Settings, *, version: str) -> None:
    """按配置装配链路。关闭时是纯粹的「什么都不做」。"""
    if not settings.telemetry_enabled:
        return
    if _tracer is not None:
        # OTel 的 provider 是进程单例，重复装配只会让 SDK 打一串告警，这里挡在前面。
        logger.warning("链路追踪已装配，忽略重复的 setup()")
        return

    provider = _build_provider(settings, version=version)
    install(provider, provider.get_tracer("compute"))
    logger.info(
        "链路追踪已开启：service=%s endpoint=%s ratio=%s",
        settings.telemetry_service_name,
        traces_endpoint(settings.telemetry_endpoint),
        settings.telemetry_sample_ratio,
    )


def install(provider: TracerProvider, tracer: Tracer) -> None:
    """接管装配结果。测试注入内存导出器时直接用这个，绕过 OTel 的单例约束。"""
    global _provider, _tracer
    _provider = provider
    _tracer = tracer


def shutdown() -> None:
    """导出残留 span 并收尾；可重复调用。"""
    global _provider, _tracer
    provider = _provider
    _provider = None
    _tracer = None
    if provider is not None:
        provider.shutdown()


def start_server_span(
    upstream: trace.TraceContext | None, *, method: str, path: str
) -> ServerSpan | None:
    """开一个 server span，父 span 是上游的 `traceparent`；未接 OTel 时返回 None。

    span 名与属性对齐 `trace.rs` 的 `server_span` / `record_status`：后端看到的是
    `GET /internal/v1/...`，并带语义约定的方法、路径、响应状态码。
    """
    tracer = _tracer
    if tracer is None:
        return None
    span = tracer.start_span(
        f"{method} {path}",
        context=_parent_context(upstream),
        kind=SpanKind.SERVER,
        attributes={"http.request.method": method, "url.path": path},
    )
    return ServerSpan(span)


@asynccontextmanager
async def outbound_span(
    method: str, path: str, headers: MutableMapping[str, str]
) -> AsyncIterator[None]:
    """出站调用的 client span：同时把 `traceparent` 写进 `headers`（覆盖内置那枚）。

    内置实现给的 `traceparent` 与这里给的是同一个 trace-id，但 span-id 不同（各自新开一个
    span 才是对的）。接了 OTel 就以 OTel 的标识为准，保证「导出 span 的父子关系」与
    「cogito 侧收到的 traceparent」是同一份事实。
    """
    tracer = _tracer
    if tracer is None:
        yield
        return
    with tracer.start_as_current_span(
        f"{method} {path}",
        kind=SpanKind.CLIENT,
        attributes={"http.request.method": method, "url.path": path},
    ) as span:
        _PROPAGATOR.inject(headers, context=set_span_in_context(span))
        yield


class ServerSpan:
    """请求级 server span 的薄封装：只管「什么时候是当前 span」与「状态码怎么记」。"""

    __slots__ = ("_span",)

    def __init__(self, span: Span) -> None:
        self._span = span

    @contextmanager
    def active(self) -> Iterator[Span]:
        """进入本 span 的作用域；退出时结束它（`ContextVar` 里的上下文随之还原）。"""
        with use_span(self._span, end_on_exit=True) as span:
            yield span

    def record_status(self, status: int) -> None:
        """响应状态落回 span：5xx 记为错误（服务端故障），4xx 只作属性（客户端问题）。"""
        self._span.set_attribute("http.response.status_code", status)
        if status >= HTTPStatus.INTERNAL_SERVER_ERROR:
            self._span.set_status(Status(StatusCode.ERROR, _reason(status)))


def _build_provider(settings: Settings, *, version: str) -> TracerProvider:
    resource = Resource.create(
        {
            "service.name": settings.telemetry_service_name,
            "service.version": version,
            "deployment.environment.name": settings.environment,
        }
    )
    exporter = OTLPSpanExporter(
        endpoint=traces_endpoint(settings.telemetry_endpoint),
        # 上游给的是毫秒，Python 导出器收的是秒。
        timeout=settings.telemetry_timeout_ms / 1000,
    )
    provider = TracerProvider(
        resource=resource,
        # 与 cogito 同款：上游已带采样决定时跟随上游，只有根 span 才掷骰子。
        sampler=ParentBased(root=TraceIdRatioBased(settings.telemetry_sample_ratio)),
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    return provider


def _parent_context(upstream: trace.TraceContext | None) -> Context:
    """把内置的链路坐标翻译成 OTel 的父上下文；没有上游时返回空上下文（成为根 span）。"""
    if upstream is None:
        return Context()
    remote = SpanContext(
        trace_id=int(upstream.trace_id, 16),
        span_id=int(upstream.span_id, 16),
        is_remote=True,
        # 只认最低位（W3C 的 sampled）；内置实现可能带上别的位，直接当 int 会炸。
        trace_flags=TraceFlags(int(upstream.flags, 16) & 0x01),
    )
    return set_span_in_context(NonRecordingSpan(remote))


def _reason(status: int) -> str:
    try:
        return HTTPStatus(status).phrase
    except ValueError:
        return "server error"
