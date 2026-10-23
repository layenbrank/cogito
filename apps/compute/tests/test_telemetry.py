"""链路追踪接入的三层保障。

* **没接 collector 时什么都不做**：不建 provider、不联网、出站头原样不动 —— 这是「接入前后
  行为一致」的前提，所以逐个入口都要钉住。
* **接上之后**：server span 认上游的 `traceparent` 当父 span，出站再续一层，且**线路上的
  `traceparent` 与导出的 span 是同一份事实**（否则 Jaeger 里的父子关系会与 cogito 侧对不上）。
* **规则对齐 cogito**：endpoint 的补路径规则、4xx/5xx 的状态记法，两侧同源。
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from httpx import AsyncClient
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind, StatusCode
from pydantic import ValidationError

from compute import telemetry, trace
from compute.api.health import HEALTH_PATH
from support import TRACEPARENT, internal_headers, make_settings

PING = "/internal/v1/_test/ping"
MISSING = "/internal/v1/_test/nope"
ASSET_ID = "8f14e45f-ceea-467a-9a3e-1b7c2d5e9f01"
CHUNKS = f"/internal/v1/assets/{ASSET_ID}/chunks"
CHUNK_BODY: dict[str, Any] = {
    "schemaVersion": 1,
    "tenantID": "tenant-a",
    "mime": "text/plain",
    "name": "notes.txt",
}
IDEMPOTENCY_KEY = "telemetry-key-0001"

#: 上游（cogito）发来的链路坐标：32 个 1 的 trace-id、16 个 2 的 span-id。
UPSTREAM = trace.TraceContext(trace_id="1" * 32, span_id="2" * 16, flags="01")


@pytest.fixture
def spans() -> Iterator[InMemorySpanExporter]:
    """本用例内接管链路：装内存导出器，结束后回到「未接入」状态。"""
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    telemetry.install(provider, provider.get_tracer("test"))
    try:
        yield exporter
    finally:
        telemetry.shutdown()


def only_span(exporter: InMemorySpanExporter) -> ReadableSpan:
    finished = exporter.get_finished_spans()
    assert len(finished) == 1
    return finished[0]


def span_of_kind(exporter: InMemorySpanExporter, kind: SpanKind) -> ReadableSpan:
    matches = [span for span in exporter.get_finished_spans() if span.kind == kind]
    assert len(matches) == 1
    return matches[0]


def attribute(span: ReadableSpan, key: str) -> object:
    assert span.attributes is not None
    return span.attributes[key]


# `ReadableSpan` 的 `context` / `parent` 在 SDK 里都不带类型标注（Any），取整数得自己收口。


def exported_span_id(span: ReadableSpan) -> int:
    assert span.context is not None
    return int(span.context.span_id)


def exported_parent_id(span: ReadableSpan) -> int:
    assert span.parent is not None
    return int(span.parent.span_id)


# ── 配置与 endpoint ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("endpoint", "expected"),
    [
        # 只给基址：补默认路径。
        ("http://127.0.0.1:4318", "http://127.0.0.1:4318/v1/traces"),
        # 带路径（collector 挂在网关后面）：原样使用。
        ("http://collector:4318/otlp/v1/traces", "http://collector:4318/otlp/v1/traces"),
        # 首尾空白与尾斜杠是手写配置的常客。
        ("  https://otlp.internal/  ", "https://otlp.internal/v1/traces"),
        # 没有 scheme 就不猜：交给导出器报错，胜过偷偷发到一个猜错的地址。
        ("collector:4318", "collector:4318"),
    ],
)
def test_traces_endpoint_follows_the_cogito_rules(endpoint: str, expected: str) -> None:
    assert telemetry.traces_endpoint(endpoint) == expected


def test_broken_endpoint_is_allowed_while_telemetry_is_off() -> None:
    """关着追踪时，一个没人用的 endpoint 不该拦住启动。"""
    settings = make_settings(telemetry_enabled=False, telemetry_endpoint="collector:4318")

    assert settings.telemetry_enabled is False


def test_enabling_telemetry_validates_its_own_settings() -> None:
    with pytest.raises(ValidationError, match="TELEMETRY_ENDPOINT"):
        make_settings(telemetry_enabled=True, telemetry_endpoint="collector:4318")

    with pytest.raises(ValidationError, match="TELEMETRY_TIMEOUT_MS"):
        make_settings(telemetry_enabled=True, telemetry_timeout_ms=0)

    with pytest.raises(ValidationError, match="TELEMETRY_SERVICE_NAME"):
        make_settings(telemetry_enabled=True, telemetry_service_name="   ")


# ── 未接入：三个入口都必须是空操作 ─────────────────────────────────────────────


def test_disabled_setup_installs_nothing() -> None:
    telemetry.setup(make_settings(), version="0.0.0-test")

    assert telemetry.is_enabled() is False
    assert telemetry.start_server_span(UPSTREAM, method="GET", path=PING) is None


async def test_disabled_outbound_call_keeps_the_builtin_traceparent() -> None:
    """出站头由内置实现填好，追踪关着时不能被改写成别的东西。"""
    builtin = trace.child_of(UPSTREAM).raw
    headers = {trace.TRACEPARENT_HEADER: builtin, "accept": "application/json"}

    async with telemetry.outbound_span("POST", "/api/v1/service/token", headers):
        pass

    assert headers == {trace.TRACEPARENT_HEADER: builtin, "accept": "application/json"}


def test_setup_with_a_real_exporter_is_idempotent_and_reversible() -> None:
    settings = make_settings(telemetry_enabled=True, telemetry_endpoint="http://127.0.0.1:4318")

    telemetry.setup(settings, version="0.0.0-test")
    try:
        assert telemetry.is_enabled() is True
        # 装配过就不再装：OTel 的 provider 是进程单例，重复装配只会刷告警。
        telemetry.setup(settings, version="0.0.0-test")
        assert telemetry.is_enabled() is True
    finally:
        telemetry.shutdown()

    assert telemetry.is_enabled() is False
    telemetry.shutdown()  # 收尾可重复


# ── 接入后：server span 认上游当父 span ────────────────────────────────────────


async def test_server_span_continues_the_upstream_trace(
    spans: InMemorySpanExporter, offline_client: AsyncClient
) -> None:
    response = await offline_client.get(PING, headers=internal_headers())

    # 回显语义归内置实现：响应头逐字等于入站值（cogito 的日志照旧能按它对上）。
    assert response.headers[trace.TRACEPARENT_HEADER] == TRACEPARENT

    span = only_span(spans)
    assert span.name == f"GET {PING}"
    assert span.kind == SpanKind.SERVER
    assert exported_span_id(span) != int(UPSTREAM.span_id, 16)
    assert span.parent is not None
    assert span.parent.trace_id == int(UPSTREAM.trace_id, 16)
    assert exported_parent_id(span) == int(UPSTREAM.span_id, 16)
    assert span.status.status_code == StatusCode.UNSET


async def test_server_span_records_the_request_and_the_status(
    spans: InMemorySpanExporter, offline_client: AsyncClient
) -> None:
    await offline_client.get(PING, headers=internal_headers())

    span = only_span(spans)

    assert attribute(span, "http.request.method") == "GET"
    assert attribute(span, "url.path") == PING
    assert attribute(span, "http.response.status_code") == 200
    assert span.status.status_code == StatusCode.UNSET


async def test_health_probe_without_upstream_starts_its_own_trace(
    spans: InMemorySpanExporter, offline_client: AsyncClient
) -> None:
    """探针不带链路：span 自成根，不能让整个导出带上一堆悬空的父 span。"""
    await offline_client.get(HEALTH_PATH)

    span = only_span(spans)

    assert span.name == f"GET {HEALTH_PATH}"
    assert span.parent is None
    assert exported_span_id(span) != 0


async def test_client_errors_do_not_fail_the_span(
    spans: InMemorySpanExporter, offline_client: AsyncClient
) -> None:
    """404 是调用方的问题：状态码记下来就够了，别让 trace 里满屏红色错误。"""
    response = await offline_client.get(MISSING, headers=internal_headers())

    assert response.status_code == 404

    span = only_span(spans)
    assert attribute(span, "http.response.status_code") == 404
    assert span.status.status_code == StatusCode.UNSET


async def test_server_faults_fail_the_span(
    spans: InMemorySpanExporter, offline_client: AsyncClient
) -> None:
    """库连不上 → 503：服务端故障必须记成 Error，不能只留一个数字。"""
    response = await offline_client.post(
        CHUNKS, json=CHUNK_BODY, headers=internal_headers(idempotency_key=IDEMPOTENCY_KEY)
    )

    assert response.status_code == 503

    span = only_span(spans)
    assert attribute(span, "http.response.status_code") == 503
    assert span.status.status_code == StatusCode.ERROR


# ── 接入后：出站调用续在同一条 trace 上 ────────────────────────────────────────


async def test_outbound_call_injects_a_fresh_child_span(
    spans: InMemorySpanExporter,
) -> None:
    server = telemetry.start_server_span(UPSTREAM, method="POST", path=CHUNKS)
    assert server is not None

    headers: dict[str, str] = {}
    with server.active():
        async with telemetry.outbound_span("POST", "/api/v1/service/token", headers):
            pass

    injected = trace.TraceContext.parse(headers[trace.TRACEPARENT_HEADER])
    assert injected is not None
    assert injected.trace_id == UPSTREAM.trace_id
    assert injected.span_id != UPSTREAM.span_id

    client_span = span_of_kind(spans, SpanKind.CLIENT)
    server_span = span_of_kind(spans, SpanKind.SERVER)

    assert client_span.name == "POST /api/v1/service/token"
    # 线路上的 `traceparent` 就是导出 span 自己的标识：两侧看到的是同一份事实。
    assert exported_span_id(client_span) == int(injected.span_id, 16)
    assert exported_parent_id(client_span) == exported_span_id(server_span)


async def test_outbound_spans_nest_under_the_trace_that_started_them(
    spans: InMemorySpanExporter,
) -> None:
    """连开两个出站 span：各拿一个新 span-id，父级始终是 server span。"""
    server = telemetry.start_server_span(UPSTREAM, method="GET", path=PING)
    assert server is not None

    first: dict[str, str] = {}
    second: dict[str, str] = {}
    with server.active():
        async with telemetry.outbound_span("GET", "/a", first):
            pass
        async with telemetry.outbound_span("GET", "/b", second):
            pass

    assert first[trace.TRACEPARENT_HEADER] != second[trace.TRACEPARENT_HEADER]

    server_span = span_of_kind(spans, SpanKind.SERVER)
    parent_ids = {
        exported_parent_id(span)
        for span in spans.get_finished_spans()
        if span.kind == SpanKind.CLIENT
    }

    assert parent_ids == {exported_span_id(server_span)}
