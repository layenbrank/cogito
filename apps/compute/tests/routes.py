"""只有测试才挂载的路由。

它们存在的唯一理由是**把中间件与幂等闸门钉住**：这两个机制是横切的，等 P6b-3 的
真路由落地再验就太晚了。测试路由不进 `create_app`，`test_route_surface` 也只看裸应用。
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors, idempotency, trace

router = APIRouter()

ECHO_ENDPOINT = "test:echo"
BOOM_ENDPOINT = "test:boom"


@router.get("/internal/v1/_test/ping")
async def ping() -> dict[str, bool]:
    """不碰数据库、不碰 cogito，用来单独观察中间件行为。"""
    return {"pong": True}


@router.get("/internal/v1/_test/trace")
async def trace_id() -> dict[str, str | None]:
    """把当前 trace-id 报出来：验证中间件写进 ContextVar 的上下文真的到得了路由。"""
    return {"traceID": trace.current_trace_id()}


@router.post("/internal/v1/_test/echo")
async def echo(request: Request) -> JSONResponse:
    """每次都生成一个新 `taskID`；重发拿到同一个 `taskID` 就说明走的是回放而非重执行。"""
    payload = await request.json()
    async with idempotency.guarded(request, endpoint=ECHO_ENDPOINT, payload=payload) as run:
        replay = idempotency.replay_response(run)
        if replay is not None:
            return replay
        body = {"echo": payload, "taskID": uuid4().hex}
        run.record(status=200, body=body)
        return JSONResponse(body)


@router.post("/internal/v1/_test/boom")
async def boom(request: Request) -> JSONResponse:
    """执行到一半失败：用来验证幂等占位会被释放，调用方能用同一个键立刻重试。"""
    payload = await request.json()
    async with idempotency.guarded(request, endpoint=BOOM_ENDPOINT, payload=payload) as _run:
        raise errors.internal_error("测试用的人为失败")
