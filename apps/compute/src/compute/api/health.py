"""健康探针 `GET /internal/v1/health`（契约：唯一不需要令牌的端点）。

cogito 用它的 `status` 决定要不要把活动派过来。判定标准是**「能不能干活」**：
数据库或 pgvector 不可用就回 503 `degraded`，绝不自报 `ok`。

失败原因只写日志：这是内部探针，但仍不该把 DSN、堆栈这类东西回给调用方。
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from compute import __version__, capabilities
from compute.db import Database

logger = logging.getLogger(__name__)

HEALTH_PATH = "/internal/v1/health"
#: cogito 对 readiness 的超时很短，所以这里只做「一次 SELECT + 一次目录查询」，不做迁移检查。
router = APIRouter()


class HealthResponse(BaseModel):
    """契约 `HealthResponse`：只有这三个字段。"""

    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"]
    version: str
    capabilities: list[str]


@router.get(
    HEALTH_PATH,
    response_model=HealthResponse,
    responses={503: {"model": HealthResponse}},
    summary="健康探针",
)
async def health(request: Request) -> JSONResponse:
    database: Database = request.app.state.db
    probe = await database.probe()

    payload = HealthResponse(
        status="ok" if probe.ok else "degraded",
        version=__version__,
        capabilities=capabilities.registry.names(),
    )
    if probe.ok:
        return JSONResponse(payload.model_dump())

    logger.warning("健康探针降级：%s", probe.detail)
    return JSONResponse(payload.model_dump(), status_code=503)
