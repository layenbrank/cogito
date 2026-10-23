"""错误口径：唯一契约源 `apps/service/spec/internal.yaml` 的 ``ErrorResponse``。

```
{"error": {"code": "...", "message": "..."}}
```

`code` 是机器可读的稳定值（cogito 侧据此决定重试与否），`message` 给人看。
**只有「确定没做成」才回 4xx**：cogito 把 429/5xx/超时当可重试，其余 4xx 直接把实例判失败。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class ErrorCode(StrEnum):
    """契约里的错误码取值。"""

    INVALID_REQUEST = "invalid_request"
    UNAUTHORIZED = "unauthorized"
    NOT_FOUND = "not_found"
    IDEMPOTENCY_CONFLICT = "idempotency_conflict"
    RATE_LIMITED = "rate_limited"
    DEPENDENCY_UNAVAILABLE = "dependency_unavailable"
    INTERNAL_ERROR = "internal_error"


_DEFAULT_STATUS: Mapping[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.UNAUTHORIZED: 401,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.IDEMPOTENCY_CONFLICT: 409,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.DEPENDENCY_UNAVAILABLE: 503,
    ErrorCode.INTERNAL_ERROR: 500,
}


class ApiError(Exception):
    """可直接变成响应的错误。路由里 ``raise`` 它，由 [`install_error_handlers`] 落地。"""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        status: int | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = _DEFAULT_STATUS[code] if status is None else status
        self.headers: dict[str, str] = dict(headers or {})

    @property
    def body(self) -> dict[str, Any]:
        return {"error": {"code": self.code.value, "message": self.message}}


def invalid_request(message: str) -> ApiError:
    return ApiError(ErrorCode.INVALID_REQUEST, message)


def unauthorized(message: str = "内部令牌缺失或无效") -> ApiError:
    return ApiError(ErrorCode.UNAUTHORIZED, message)


def not_found(message: str) -> ApiError:
    return ApiError(ErrorCode.NOT_FOUND, message)


def idempotency_conflict(message: str, *, retry_after_seconds: int | None = None) -> ApiError:
    headers = {"Retry-After": str(retry_after_seconds)} if retry_after_seconds is not None else None
    return ApiError(ErrorCode.IDEMPOTENCY_CONFLICT, message, headers=headers)


def rate_limited(message: str, *, retry_after_seconds: int | None = None) -> ApiError:
    headers = {"Retry-After": str(retry_after_seconds)} if retry_after_seconds is not None else None
    return ApiError(ErrorCode.RATE_LIMITED, message, headers=headers)


def dependency_unavailable(message: str) -> ApiError:
    return ApiError(ErrorCode.DEPENDENCY_UNAVAILABLE, message)


def internal_error(message: str = "内部错误") -> ApiError:
    return ApiError(ErrorCode.INTERNAL_ERROR, message)


def install_error_handlers(app: FastAPI) -> None:
    """把所有异常都收敛成契约里的 `ErrorResponse` 形状。"""

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(exc.body, status_code=exc.status, headers=exc.headers or None)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            invalid_request(f"请求体不合法：{_describe_validation(exc)}").body,
            status_code=400,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        mapped = _map_http_status(exc.status_code, str(exc.detail))
        return JSONResponse(mapped.body, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Starlette 仍会把异常重新抛出交给服务器记录（uvicorn 会打日志），这里只负责响应体。
        logger.error("未预期的异常：%s %s", request.method, request.url.path, exc_info=exc)
        return JSONResponse(internal_error().body, status_code=500)


def _map_http_status(status: int, detail: str) -> ApiError:
    message = detail or "请求失败"
    if status == 404:
        return not_found(message)
    if status == 401:
        return unauthorized(message)
    if status == 429:
        return rate_limited(message)
    if status >= 500:
        return internal_error(message)
    return invalid_request(message)


def _describe_validation(exc: RequestValidationError) -> str:
    """只取「字段 + 原因」，不回显整份请求体（正文可能很大，也可能含敏感值）。"""
    parts: list[str] = []
    for error in exc.errors()[:5]:
        location = ".".join(str(item) for item in error.get("loc", ()) if item != "body")
        parts.append(f"{location or 'body'}: {error.get('msg', 'invalid')}")
    return "; ".join(parts) or "invalid"
