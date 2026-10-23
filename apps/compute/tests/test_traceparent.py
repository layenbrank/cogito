"""`traceparent` 闸门：校验规则、回写响应头、以及 trace-id 真的传到了路由。

最后一条是关键回归——用 `BaseHTTPMiddleware` 实现时它**看起来**也对，
但路由拿到的 ContextVar 会是空的，跨语言排障直接断链。
"""

from __future__ import annotations

import re

from httpx import AsyncClient, Response

from compute import errors, trace
from compute.api.health import HEALTH_PATH
from support import TRACEPARENT, internal_headers, traceparent_only

PING = "/internal/v1/_test/ping"
TRACE_PATH = "/internal/v1/_test/trace"
VALID_SHAPE = re.compile(r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$")


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


def traceparent_with(*, trace_id: str = "1" * 32, span_id: str = "2" * 16) -> str:
    return f"00-{trace_id}-{span_id}-01"


async def test_valid_traceparent_is_echoed_back(offline_client: AsyncClient) -> None:
    response = await offline_client.get(PING, headers=internal_headers())

    assert response.status_code == 200
    assert response.headers["traceparent"] == TRACEPARENT


async def test_trace_id_reaches_the_route(offline_client: AsyncClient) -> None:
    response = await offline_client.get(TRACE_PATH, headers=internal_headers())

    assert response.json()["traceID"] == TRACEPARENT.split("-")[1]


async def test_missing_traceparent_is_rejected(offline_client: AsyncClient) -> None:
    response = await offline_client.get(PING, headers=internal_headers(traceparent=None))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST


async def test_malformed_traceparent_is_rejected(offline_client: AsyncClient) -> None:
    response = await offline_client.get(PING, headers=internal_headers(traceparent="garbage"))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST


async def test_uppercase_hex_is_rejected(offline_client: AsyncClient) -> None:
    """契约的 pattern 是小写十六进制；放过大写会让两侧日志按不同的 key 聚合。"""
    uppercase = traceparent_with(trace_id="A" * 32)

    response = await offline_client.get(PING, headers=internal_headers(traceparent=uppercase))

    assert response.status_code == 400


async def test_all_zero_ids_are_rejected(offline_client: AsyncClient) -> None:
    """W3C 规定全 0 的 trace-id / span-id 非法——只靠契约的 pattern 拦不住。"""
    headers = internal_headers(traceparent=traceparent_with(trace_id="0" * 32))
    zero_span = internal_headers(traceparent=traceparent_with(span_id="0" * 16))

    assert (await offline_client.get(PING, headers=headers)).status_code == 400
    assert (await offline_client.get(PING, headers=zero_span)).status_code == 400


async def test_unsupported_version_is_rejected(offline_client: AsyncClient) -> None:
    response = await offline_client.get(
        PING, headers=internal_headers(traceparent=TRACEPARENT.replace("00-", "01-", 1))
    )

    assert response.status_code == 400


async def test_traceparent_is_checked_after_the_token(offline_client: AsyncClient) -> None:
    """先验令牌：不合规的 traceparent 也不该把「内部规则」透露给没令牌的调用方。"""
    response = await offline_client.get(PING, headers=traceparent_only("garbage"))

    assert response.status_code == 401


async def test_health_generates_its_own_traceparent(offline_client: AsyncClient) -> None:
    """探针不带链路也要能跑，回一条自造的，方便把探针本身也串进日志。"""
    first = await offline_client.get(HEALTH_PATH)
    second = await offline_client.get(HEALTH_PATH)

    assert VALID_SHAPE.match(first.headers["traceparent"])
    assert first.headers["traceparent"] != second.headers["traceparent"]


def test_parse_rejects_garbage_and_padding() -> None:
    assert trace.TraceContext.parse(None) is None
    assert trace.TraceContext.parse(" 00-not-a-trace ") is None
    assert trace.TraceContext.parse(TRACEPARENT) is not None


def test_child_of_keeps_trace_id_and_changes_span_id() -> None:
    parent = trace.TraceContext.parse(TRACEPARENT)
    assert parent is not None

    child = trace.child_of(parent)

    assert child.trace_id == parent.trace_id
    assert child.span_id != parent.span_id
    assert child.flags == parent.flags
