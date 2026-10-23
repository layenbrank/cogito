"""幂等：`Idempotency-Key` 的账本与上下文管理器。

cogito 把每个活动都算出一个确定性的键（例如 `rag-index-<assetID>:embed:0-16`），
遇到超时或网络抖动时会原样重发。所以这里必须回答三个问题：这笔活干过没有、
正在干还是干完了、以及「干完之后重发」如何给出**和第一次一模一样**的响应。

`reserve()` 用「先插后读」的乐观法（而不是先读后插）来躲并发：两个副本同时到达时
只有一个能插进去，另一个在 `ON CONFLICT` 上等前一个事务结束后，再读到的就是既成事实。
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from asyncpg import Connection, Record
from fastapi import Request
from fastapi.responses import JSONResponse

from compute import errors
from compute.db import Database, DatabaseUnavailableError

logger = logging.getLogger(__name__)

HEADER_NAME = "Idempotency-Key"
MIN_KEY_LENGTH = 8
MAX_KEY_LENGTH = 200
_IN_FLIGHT_RETRY_AFTER_SECONDS = 1
#: 「先插后读」可能撞上「对方刚好回滚释放了这行」的极小概率窗口，重试几次即可。
_RESERVE_ATTEMPTS = 3

_SELECT = """
SELECT payload_sha, status, response_status, response_body, updated_at
  FROM idempotency_key
 WHERE idempotency_key = $1 AND endpoint = $2
"""


class Outcome(StrEnum):
    """`reserve()` 的结论。"""

    PROCEED = "proceed"
    REPLAY = "replay"
    CONFLICT = "conflict"
    IN_FLIGHT = "in_flight"


@dataclass(frozen=True, slots=True)
class Replay:
    """上一次执行留下的响应（原样回放）。"""

    status: int
    body: Any


@dataclass(frozen=True, slots=True)
class Reservation:
    outcome: Outcome
    replay: Replay | None = None


def payload_digest(payload: Any) -> str:
    """载荷指纹。字段序无关、非 ASCII 不转义，跨进程可复现。"""
    canonical = json.dumps(
        payload,
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def require_key(request: Request) -> str:
    """取并校验请求头里的幂等键（契约：8–200 字符）。"""
    raw = request.headers.get(HEADER_NAME)
    if raw is None:
        message = f"缺少 {HEADER_NAME} 请求头"
        raise errors.invalid_request(message)
    key = raw.strip()
    if not MIN_KEY_LENGTH <= len(key) <= MAX_KEY_LENGTH:
        message = f"{HEADER_NAME} 长度必须在 {MIN_KEY_LENGTH}–{MAX_KEY_LENGTH} 之间"
        raise errors.invalid_request(message)
    return key


async def reserve(
    connection: Connection,
    *,
    key: str,
    endpoint: str,
    payload_sha: str,
    stale_seconds: int,
) -> Reservation:
    """占位或判定。返回 PROCEED 时调用方**拥有**这条键，最终必须 `complete()` 或 `release()`。"""
    for attempt in range(_RESERVE_ATTEMPTS):
        async with connection.transaction():
            inserted = await connection.fetchval(
                """
                INSERT INTO idempotency_key (idempotency_key, endpoint, payload_sha, status)
                VALUES ($1, $2, $3, 'in_progress')
                ON CONFLICT (idempotency_key, endpoint) DO NOTHING
                RETURNING idempotency_key
                """,
                key,
                endpoint,
                payload_sha,
            )
            if inserted is not None:
                return Reservation(Outcome.PROCEED)

            row = await connection.fetchrow(f"{_SELECT} FOR UPDATE", key, endpoint)
            if row is None:
                # 上一个持有者在我们等待期间回滚并释放了这行，重来一次。
                logger.debug("幂等键 %s 刚被释放，重试占位（第 %d 次）", key, attempt + 1)
                continue
            return _classify(row, key=key, payload_sha=payload_sha, stale_seconds=stale_seconds)

    message = "幂等键占位反复失败，请稍后重试"  # pragma: no cover - 需要极端并发才触发
    raise errors.dependency_unavailable(message)


def _classify(row: Record, *, key: str, payload_sha: str, stale_seconds: int) -> Reservation:
    if row["payload_sha"] != payload_sha:
        return Reservation(Outcome.CONFLICT)

    if row["status"] == "completed":
        return Reservation(
            Outcome.REPLAY,
            Replay(status=row["response_status"] or 200, body=json.loads(row["response_body"])),
        )

    age = (datetime.now(UTC) - row["updated_at"]).total_seconds()
    if age <= stale_seconds:
        return Reservation(Outcome.IN_FLIGHT)

    # 上一个执行者多半是被硬杀掉的，留着这条键会把该资产永久卡死。
    logger.warning("幂等键 %s 已停留在 in_progress %.0f 秒，判定为死键并接管", key, age)
    return Reservation(Outcome.PROCEED)


async def complete(
    connection: Connection,
    *,
    key: str,
    endpoint: str,
    payload_sha: str,
    status: int,
    body: Any,
) -> None:
    """记账完成，并保存响应体供后续重发回放。"""
    await connection.execute(
        """
        UPDATE idempotency_key
           SET status = 'completed',
               response_status = $4,
               response_body = $5::jsonb,
               updated_at = now()
         WHERE idempotency_key = $1 AND endpoint = $2 AND payload_sha = $3
        """,
        key,
        endpoint,
        payload_sha,
        status,
        json.dumps(body, ensure_ascii=False, default=str),
    )


async def release(connection: Connection, *, key: str, endpoint: str, payload_sha: str) -> None:
    """释放（删除）自己持有的进行中占位，让调用方能立刻用同一个键重试。"""
    await connection.execute(
        """
        DELETE FROM idempotency_key
         WHERE idempotency_key = $1 AND endpoint = $2
           AND status = 'in_progress' AND payload_sha = $3
        """,
        key,
        endpoint,
        payload_sha,
    )


@dataclass(slots=True)
class IdempotencyRun:
    """正在执行的一次调用。路由用它记录最终响应。"""

    #: 这次调用占用的幂等键与载荷指纹。路由据此推导**确定性**的产物 id
    #: （例如 RAG 的 `chunk_set_id`），让「写库成功但记账前被杀」也能自愈。
    key: str = ""
    payload_sha: str = ""
    replay: Replay | None = None
    recorded: tuple[int, Any] | None = field(default=None, repr=False)

    def record(self, *, status: int, body: Any) -> None:
        self.recorded = (status, body)


@asynccontextmanager
async def guarded(
    request: Request, *, endpoint: str, payload: Any
) -> AsyncIterator[IdempotencyRun]:
    """把「闸门 + 幂等」包成一段 `async with`：

    * 重发 → `run.replay` 非空，调用方原样回放后 `return`；
    * 同键不同载荷 → 409；仍在执行中 → 409 + `Retry-After`；
    * 正常路径：调用方 `run.record(...)` 记账，退出时落库；
    * 异常路径：释放占位，让调用方能立刻重试。

    `return` 写在 `async with` 里同样安全 —— `__aexit__` 会先跑完再交还控制权。
    """
    key = require_key(request)
    payload_sha = payload_digest(payload)
    settings = request.app.state.settings
    database: Database = request.app.state.db

    try:
        async with database.acquire() as connection:
            reservation = await reserve(
                connection,
                key=key,
                endpoint=endpoint,
                payload_sha=payload_sha,
                stale_seconds=settings.idempotency_stale_seconds,
            )

            if reservation.outcome is Outcome.CONFLICT:
                message = (
                    f"{HEADER_NAME} 已被同一端点的另一次调用占用，但载荷不同；"
                    "请勿为不同的请求复用同一个键"
                )
                raise errors.idempotency_conflict(message)
            if reservation.outcome is Outcome.IN_FLIGHT:
                message = f"{HEADER_NAME} 对应的调用仍在执行中，请稍后重试"
                raise errors.idempotency_conflict(
                    message, retry_after_seconds=_IN_FLIGHT_RETRY_AFTER_SECONDS
                )

            run = IdempotencyRun(key=key, payload_sha=payload_sha, replay=reservation.replay)
            if run.replay is not None:
                yield run
                return

            try:
                yield run
            except BaseException:
                await release(connection, key=key, endpoint=endpoint, payload_sha=payload_sha)
                raise
            else:
                if run.recorded is not None:
                    status, body = run.recorded
                    await complete(
                        connection,
                        key=key,
                        endpoint=endpoint,
                        payload_sha=payload_sha,
                        status=status,
                        body=body,
                    )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc


def replay_response(run: IdempotencyRun) -> JSONResponse | None:
    """`run.replay` 非空时给出可直接返回的响应。"""
    if run.replay is None:
        return None
    return JSONResponse(run.replay.body, status_code=run.replay.status)
