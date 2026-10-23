"""W3C Trace Context（`traceparent`）的解析与进程内传递。

跨语言排障只能靠它：cogito 的每个活动都确定性地派生一条 `traceparent` 发过来，
compute 只做两件事 —— **校验**（不合规即 400，见契约的 header pattern）与**回写响应头**，
好让两侧的日志能按同一个 trace-id 对上。

校验比契约的 pattern 稍严：W3C 规定全 0 的 trace-id / span-id 非法。
"""

from __future__ import annotations

import re
import secrets
from contextvars import ContextVar, Token
from dataclasses import dataclass

#: 契约里 `Traceparent` 参数的 pattern，与 `apps/service/spec/internal.yaml` 逐字一致。
TRACEPARENT_PATTERN = r"^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$"
#: 同一套字符集，只是加了分组以便从匹配结果里取值。
_TRACEPARENT_RE = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")

_ZERO_TRACE_ID = "0" * 32
_ZERO_SPAN_ID = "0" * 16
_DEFAULT_FLAGS = "01"

TRACEPARENT_HEADER = "traceparent"


@dataclass(frozen=True, slots=True)
class TraceContext:
    """一条链路的坐标。``raw`` 与请求/响应头里的字符串逐字一致。"""

    trace_id: str
    span_id: str
    flags: str

    @property
    def raw(self) -> str:
        return f"00-{self.trace_id}-{self.span_id}-{self.flags}"

    @classmethod
    def parse(cls, value: str | None) -> TraceContext | None:
        """解析成功返回上下文，否则 None（调用方决定是 400 还是自己造一条）。"""
        if value is None:
            return None
        match = _TRACEPARENT_RE.match(value.strip())
        if match is None:
            return None
        trace_id, span_id, flags = match.groups()
        if trace_id == _ZERO_TRACE_ID or span_id == _ZERO_SPAN_ID:
            return None
        return cls(trace_id=trace_id, span_id=span_id, flags=flags)


def child_of(context: TraceContext) -> TraceContext:
    """同一条链路的下一个 span（出站请求用）：trace-id 不变、span-id 换新。"""
    return TraceContext(
        trace_id=context.trace_id,
        span_id=secrets.token_hex(8),
        flags=context.flags,
    )


def new_trace_context() -> TraceContext:
    """造一条根链路（健康探针这类没有上游链路的请求用）。"""
    return TraceContext(
        trace_id=secrets.token_hex(16),
        span_id=secrets.token_hex(8),
        flags=_DEFAULT_FLAGS,
    )


_current: ContextVar[TraceContext | None] = ContextVar("compute_trace", default=None)


def current() -> TraceContext | None:
    return _current.get()


def current_trace_id() -> str | None:
    context = _current.get()
    return None if context is None else context.trace_id


def set_current(context: TraceContext) -> Token[TraceContext | None]:
    return _current.set(context)


def reset_current(token: Token[TraceContext | None]) -> None:
    _current.reset(token)
