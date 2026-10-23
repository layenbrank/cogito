"""日志：每行一条 JSON，带上 `trace_id`。

JSON 行日志是为了让 cogito 侧的链路日志能和这里直接对齐（同一条 trace-id）；
uvicorn 自带的 handler 会被清掉并改成向 root 传播，避免出现两种格式混在同一个流里。
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from compute import trace

#: LogRecord 自带的字段（除这些以外的 `extra=` 都作为结构化字段输出）。
_RESERVED_ATTRS = frozenset(
    {
        *logging.LogRecord("", 0, "", 0, "", (), None).__dict__,
        "message",
        "asctime",
        "taskName",
    }
)


class JsonFormatter(logging.Formatter):
    def __init__(self, *, service: str, version: str) -> None:
        super().__init__()
        self._service = service
        self._version = version

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "service": self._service,
            "version": self._version,
            "message": record.getMessage(),
        }
        trace_id = trace.current_trace_id()
        if trace_id is not None:
            payload["trace_id"] = trace_id
        for key, value in record.__dict__.items():
            if key not in _RESERVED_ATTRS and not key.startswith("_"):
                payload.setdefault(key, value)
        if record.exc_info is not None:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(*, level: str, service: str, version: str) -> None:
    """装到 root 上，并让 uvicorn 的 logger 也走同一条路（可重复调用）。"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service=service, version=version))

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        for existing in list(logger.handlers):
            logger.removeHandler(existing)
        logger.propagate = True
