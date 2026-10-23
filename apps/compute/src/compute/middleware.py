"""入口处的两道闸门：内部共享令牌，以及 `traceparent`。

刻意用**裸 ASGI 中间件**而不是 `BaseHTTPMiddleware`：后者会把下游执行挪进另一个 anyio 任务，
`ContextVar` 的写入就传不回路由处理函数 —— trace_id 会静默丢失。

顺序（后 `add_middleware` 的在外层）：
1. [`InternalTokenMiddleware`]：缺令牌时先回 401，不因为「先撞上 traceparent 规则」而泄露内部细节；
2. [`TraceparentMiddleware`]：校验并回写 `traceparent`，接 OTel 时顺手开一个 server span。

健康探针两侧都跳过：cogito 的 readiness 不能因为网关规则而失败（契约里该端点无需令牌）。

**被闸门拒掉的请求（400 / 401）不会产生 span**：拒它的是闸门本身，没有可归属的 server span
（401 更是连本中间件都还没进）；这类请求只能在两侧日志里按状态码排查。
"""

from __future__ import annotations

import hmac
import logging
from collections.abc import Iterable
from contextlib import AbstractContextManager, nullcontext

from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from compute import errors, telemetry, trace
from compute.api.health import HEALTH_PATH

logger = logging.getLogger(__name__)

INTERNAL_TOKEN_HEADER = "X-Internal-Token"  # noqa: S105 - HTTP 头名，不是密钥
_INTERNAL_TOKEN_RAW = b"x-internal-token"
_TRACEPARENT_RAW = b"traceparent"


def header_value(scope: Scope, name: bytes) -> str | None:
    """ASGI 头是 bytes 列表；header 名在小写化后比对（协议要求小写，这里只降不确定性）。"""
    headers: Iterable[tuple[bytes, bytes]] = scope.get("headers", ())
    for key, value in headers:
        if key == name:
            return value.decode("latin-1")
    return None


class InternalTokenMiddleware:
    """`X-Internal-Token` 闸门。"""

    def __init__(self, app: ASGIApp, *, token: str) -> None:
        self._app = app
        self._expected = token.encode("utf-8")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == HEALTH_PATH:
            await self._app(scope, receive, send)
            return

        presented = header_value(scope, _INTERNAL_TOKEN_RAW)
        if presented is None or not hmac.compare_digest(presented.encode("utf-8"), self._expected):
            logger.warning(
                "拒绝缺少或错误的内部令牌：%s %s", scope.get("method"), scope.get("path")
            )
            await _send_error(scope, receive, send, errors.unauthorized())
            return

        await self._app(scope, receive, send)


class TraceparentMiddleware:
    """校验 + 回写 `traceparent`（接 OTel 时同时开 server span）。"""

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        is_health = scope.get("path") == HEALTH_PATH
        upstream = trace.TraceContext.parse(header_value(scope, _TRACEPARENT_RAW))

        if upstream is None and not is_health:
            await _send_error(
                scope,
                receive,
                send,
                errors.invalid_request(
                    "traceparent 缺失或不合规（W3C Trace Context，形如 "
                    "00-<32 位小写十六进制>-<16 位小写十六进制>-<2 位小写十六进制>）"
                ),
            )
            return

        # 回写与进程内传递用的都是**上游发来的那枚**（没上游就是自建的一条）：调用方拿到原样
        # 的值就能对上自己的链路。OTel 打开时上游仍是 server span 的父 span，只是 span 里带着
        # 本进程自己的 span-id。
        context = upstream if upstream is not None else trace.new_trace_context()
        span = telemetry.start_server_span(
            upstream, method=str(scope.get("method", "")), path=str(scope.get("path", ""))
        )
        active: AbstractContextManager[object] = nullcontext() if span is None else span.active()

        token = trace.set_current(context)
        try:
            with active:
                await self._app(scope, receive, _append_traceparent(send, context.raw, span))
        finally:
            trace.reset_current(token)


def _append_traceparent(send: Send, raw: str, span: telemetry.ServerSpan | None) -> Send:
    async def wrapped(message: Message) -> None:
        if message["type"] == "http.response.start":
            if span is not None:
                span.record_status(int(message["status"]))
            # `http.response.start` 的头部本身就是 MutableMapping，Starlette 的标注比实现窄。
            headers = MutableHeaders(scope=message)
            headers[trace.TRACEPARENT_HEADER] = raw
        await send(message)

    return wrapped


async def _send_error(scope: Scope, receive: Receive, send: Send, error: errors.ApiError) -> None:
    response = JSONResponse(error.body, status_code=error.status, headers=error.headers or None)
    await response(scope, receive, send)
