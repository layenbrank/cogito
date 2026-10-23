"""幂等账本：cogito 超时后会**原样重发**，所以这几条行为都是可用性而不是锦上添花。

键的作用域是 `(键, 端点)`：cogito 的键按活动派生，同一个键在 chunks 与 embeddings 上
语义不同，不能被当成同一个操作。
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient, Response

from compute import errors, idempotency
from compute.db import Database
from routes import BOOM_ENDPOINT, ECHO_ENDPOINT
from support import echo_payload, internal_headers

ECHO = "/internal/v1/_test/echo"
BOOM = "/internal/v1/_test/boom"
KEY = "idem-key-0001"


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


async def ledger_row(database: Database, key: str, endpoint: str) -> Any:
    async with database.acquire() as connection:
        return await connection.fetchrow(
            "SELECT status, response_status, response_body FROM idempotency_key"
            " WHERE idempotency_key = $1 AND endpoint = $2",
            key,
            endpoint,
        )


async def seed_in_progress(
    database: Database, *, key: str, endpoint: str, payload: Any, age_seconds: float = 0.0
) -> None:
    async with database.acquire() as connection:
        await connection.execute(
            """
            INSERT INTO idempotency_key
                        (idempotency_key, endpoint, payload_sha, status, created_at, updated_at)
                 VALUES ($1, $2, $3, 'in_progress',
                         now() - make_interval(secs => $4::double precision),
                         now() - make_interval(secs => $4::double precision))
            """,
            key,
            endpoint,
            idempotency.payload_digest(payload),
            age_seconds,
        )


async def test_same_key_and_payload_replays_the_same_body(
    client: AsyncClient, database: Database
) -> None:
    headers = internal_headers(idempotency_key=KEY)

    first = await client.post(ECHO, json=echo_payload(), headers=headers)
    second = await client.post(ECHO, json=echo_payload(), headers=headers)

    assert first.status_code == 200
    assert second.status_code == 200
    # taskID 每次执行都会变：两次一模一样说明第二次走的是回放而不是重执行。
    assert first.json() == second.json()
    row = await ledger_row(database, KEY, ECHO_ENDPOINT)
    assert row["status"] == "completed"
    assert row["response_status"] == 200


async def test_key_is_trimmed_before_use(client: AsyncClient) -> None:
    await client.post(ECHO, json=echo_payload(), headers=internal_headers(idempotency_key=KEY))

    response = await client.post(
        ECHO, json=echo_payload(), headers=internal_headers(idempotency_key=f"  {KEY}  ")
    )

    assert response.status_code == 200


async def test_same_key_with_different_payload_conflicts(client: AsyncClient) -> None:
    await client.post(ECHO, json=echo_payload("a"), headers=internal_headers(idempotency_key=KEY))

    response = await client.post(
        ECHO, json=echo_payload("b"), headers=internal_headers(idempotency_key=KEY)
    )

    assert response.status_code == 409
    assert error_code(response) == errors.ErrorCode.IDEMPOTENCY_CONFLICT


async def test_same_key_on_another_endpoint_is_independent(client: AsyncClient) -> None:
    headers = internal_headers(idempotency_key=KEY)

    assert (await client.post(ECHO, json=echo_payload(), headers=headers)).status_code == 200
    # boom 一定会失败，但绝不因此变成 409：端点不同就是两笔账。
    assert (await client.post(BOOM, json=echo_payload(), headers=headers)).status_code == 500


async def test_missing_key_is_rejected(client: AsyncClient) -> None:
    response = await client.post(ECHO, json=echo_payload(), headers=internal_headers())

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST


async def test_key_outside_the_contract_lengths_is_rejected(client: AsyncClient) -> None:
    short = await client.post(
        ECHO, json=echo_payload(), headers=internal_headers(idempotency_key="short")
    )
    long = await client.post(
        ECHO, json=echo_payload(), headers=internal_headers(idempotency_key="k" * 201)
    )

    assert short.status_code == 400
    assert long.status_code == 400


async def test_in_flight_key_asks_the_caller_to_retry(
    client: AsyncClient, database: Database
) -> None:
    await seed_in_progress(database, key=KEY, endpoint=ECHO_ENDPOINT, payload=echo_payload())

    response = await client.post(
        ECHO, json=echo_payload(), headers=internal_headers(idempotency_key=KEY)
    )

    assert response.status_code == 409
    assert response.headers["Retry-After"] == "1"


async def test_stale_in_flight_key_is_taken_over(client: AsyncClient, database: Database) -> None:
    """上一个执行者被硬杀掉时，键不能把资产永久卡死（stale 默认 900 秒）。"""
    await seed_in_progress(
        database, key=KEY, endpoint=ECHO_ENDPOINT, payload=echo_payload(), age_seconds=3600
    )

    response = await client.post(
        ECHO, json=echo_payload(), headers=internal_headers(idempotency_key=KEY)
    )

    assert response.status_code == 200


async def test_failed_run_releases_the_key(client: AsyncClient, database: Database) -> None:
    """失败（可重试的那类）不能留下占位，否则调用方会一直撞 409。"""
    headers = internal_headers(idempotency_key=KEY)

    first = await client.post(BOOM, json=echo_payload(), headers=headers)
    assert first.status_code == 500
    assert await ledger_row(database, KEY, BOOM_ENDPOINT) is None

    second = await client.post(BOOM, json=echo_payload(), headers=headers)

    assert second.status_code == 500
