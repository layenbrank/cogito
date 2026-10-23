"""`POST /internal/v1/assets/{assetID}/chunks`：两端都要碰的端点，所以这一组用真库 + 假 cogito。

假 cogito 只回答两件事：换令牌、给正文。真库是为了验「块真的落进去了」与幂等账本的状态——
只看响应体的话，写库失败、写重复、写半截都发现不了。

最要紧的两条：

* **重发必须回放**：cogito 超时后会原样重发，第二次不能再取一次正文，也不能产生第二份块集；
* **写库成功但记账前被杀**：块集 id 由幂等键确定性推导，重跑必须落在同一行上自愈。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any
from uuid import UUID

import httpx
import pytest
from httpx import AsyncClient, Response

from compute import errors, idempotency
from compute.cogito_client import SERVICE_TOKEN_PATH
from compute.db import Database
from compute.rag_ingest import store
from compute.rag_ingest.router import ENDPOINT, chunk_set_id_for
from support import (
    HandlerClient,
    internal_headers,
    make_settings,
    service_token_body,
    stub_cogito,
)

ASSET_ID = "8f14e45f-ceea-467a-9a3e-1b7c2d5e9f01"
PATH = f"/internal/v1/assets/{ASSET_ID}/chunks"
KEY = "chunk-key-0001"
TENANT = "tenant-a"

TEXT = "第一段正文，讲清一件事。\n\n第二段正文，讲清另一件事。\n\n第三段正文。"
SHA_OF_TEXT = hashlib.sha256(TEXT.encode()).hexdigest()


class CogitoStub:
    """带计数的 cogito 桩：记录被打了哪些路径，才能断言「重发没有再取一次正文」。"""

    def __init__(self, content: bytes = TEXT.encode(), *, content_status: int = 200) -> None:
        self.paths: list[str] = []
        self._handler = stub_cogito(content, content_status=content_status)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.paths.append(request.url.path)
        return self._handler(request)

    @property
    def content_calls(self) -> int:
        return sum(1 for path in self.paths if path != SERVICE_TOKEN_PATH)


def chunk_body(
    *,
    mime: str = "text/plain",
    name: str | None = "notes.txt",
    tenant_id: str = TENANT,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"schemaVersion": 1, "tenantID": tenant_id, "mime": mime}
    if name is not None:
        payload["name"] = name
    payload.update(extra)
    return payload


async def post_chunks(
    client: AsyncClient, *, key: str | None = KEY, payload: dict[str, Any] | None = None
) -> Response:
    return await client.post(
        PATH,
        json=chunk_body() if payload is None else payload,
        headers=internal_headers(idempotency_key=key),
    )


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


def router_payload(body: dict[str, Any], *, chunk_size: int, chunk_overlap: int) -> dict[str, Any]:
    """镜像 router 算指纹时用的载荷：省略的可选字段要填成部署默认值。"""
    return {
        "assetID": ASSET_ID,
        "tenantID": body["tenantID"],
        "mime": body["mime"],
        "name": body.get("name"),
        "chunkSize": body.get("chunkSize", chunk_size),
        "chunkOverlap": body.get("chunkOverlap", chunk_overlap),
    }


async def ledger_row(database: Database, key: str = KEY) -> Any:
    async with database.acquire() as connection:
        return await connection.fetchrow(
            "SELECT status, response_status, response_body FROM idempotency_key"
            " WHERE idempotency_key = $1 AND endpoint = $2",
            key,
            ENDPOINT,
        )


async def forget_ledger(database: Database, key: str = KEY) -> None:
    """模拟「块写进库了、记账之前进程被杀」：账本里那行不存在，块还在。"""
    async with database.acquire() as connection:
        await connection.execute(
            "DELETE FROM idempotency_key WHERE idempotency_key = $1 AND endpoint = $2",
            key,
            ENDPOINT,
        )


async def load_chunk_set(database: Database, chunk_set_id: str) -> store.ChunkSet | None:
    async with database.acquire() as connection:
        return await store.load(connection, chunk_set_id=UUID(chunk_set_id))


async def load_chunks(database: Database, chunk_set_id: str) -> list[store.StoredChunk]:
    async with database.acquire() as connection:
        return await store.load_chunks(connection, chunk_set_id=UUID(chunk_set_id))


async def test_successful_chunking_is_persisted_and_reported(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    response = await post_chunks(client, payload=chunk_body(chunkSize=20, chunkOverlap=0))

    assert response.status_code == 200
    body = response.json()
    assert body["chunkCount"] == 3
    assert body["textSha"] == SHA_OF_TEXT
    chunk_set_id = UUID(body["chunkSetID"])

    chunk_set = await load_chunk_set(database, body["chunkSetID"])
    assert chunk_set == store.ChunkSet(
        chunk_set_id=chunk_set_id,
        tenant_id=TENANT,
        asset_id=UUID(ASSET_ID),
        mime="text/plain",
        name="notes.txt",
        text_sha=SHA_OF_TEXT,
        chunk_count=3,
        chunk_size=20,
        chunk_overlap=0,
        extractor="text",
        source_bytes=len(TEXT.encode()),
    )

    chunks = await load_chunks(database, body["chunkSetID"])
    assert [chunk.ordinal for chunk in chunks] == [0, 1, 2]
    assert [chunk.text for chunk in chunks] == TEXT.split("\n\n")
    for chunk in chunks:
        assert TEXT[chunk.char_start : chunk.char_end] == chunk.text

    row = await ledger_row(database)
    assert (row["status"], row["response_status"]) == ("completed", 200)
    # jsonb 读回来是字符串（asyncpg 的 jsonb codec 不做解码），且键序会被 PG 归一化，所以先解析。
    assert json.loads(row["response_body"]) == body


async def test_chunk_set_id_is_derived_from_the_idempotency_key() -> None:
    """同一个键 + 同一个载荷 → 同一个 id。这是「写库后被杀死」能自愈的前提。"""
    first = chunk_set_id_for(KEY, "sha-a")
    assert first == chunk_set_id_for(KEY, "sha-a")
    assert first != chunk_set_id_for(KEY, "sha-b")
    assert first != chunk_set_id_for("chunk-key-0002", "sha-a")


async def test_replay_does_not_refetch_or_duplicate(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    first = await post_chunks(client, payload=chunk_body(chunkSize=20, chunkOverlap=0))
    second = await post_chunks(client, payload=chunk_body(chunkSize=20, chunkOverlap=0))

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == second.json()
    assert cogito.content_calls == 1
    assert len(await load_chunks(database, first.json()["chunkSetID"])) == 3
    assert cogito.paths.count(SERVICE_TOKEN_PATH) == 1


async def test_explicit_defaults_are_the_same_request_as_omitting_them(
    cogito_backed_client: HandlerClient,
) -> None:
    """cogito 重发时少带一个可选字段不能被判成 409：载荷指纹取的是**生效后**的参数。"""
    client = cogito_backed_client(CogitoStub())

    first = await post_chunks(client, payload=chunk_body())
    second = await post_chunks(client, payload=chunk_body(chunkSize=1200, chunkOverlap=200))

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["chunkSetID"] == second.json()["chunkSetID"]


async def test_same_key_with_a_different_payload_conflicts(
    cogito_backed_client: HandlerClient,
) -> None:
    client = cogito_backed_client(CogitoStub())

    assert (await post_chunks(client)).status_code == 200
    response = await post_chunks(client, payload=chunk_body(mime="text/html", name="page.html"))

    assert response.status_code == 409
    assert error_code(response) == errors.ErrorCode.IDEMPOTENCY_CONFLICT


async def test_missing_idempotency_key_is_rejected_before_touching_core(
    cogito_backed_client: HandlerClient,
) -> None:
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    response = await post_chunks(client, key=None)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []


async def test_unknown_body_field_is_rejected_before_touching_core(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """`extra="forbid"`：多出来的字段只可能是 cogito 与这里的契约版本不一致。"""
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    response = await post_chunks(client, payload=chunk_body(mime="text/plain", surprise=1))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []
    assert await ledger_row(database) is None


def seeded_token(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json=service_token_body())


@pytest.mark.parametrize(
    ("chunk_size", "chunk_overlap"),
    [(20, 20), (20, 21), (0, 0), (32001, 0)],
)
async def test_illegal_chunk_parameters_are_rejected_before_touching_core(
    cogito_backed_client: HandlerClient, database: Database, chunk_size: int, chunk_overlap: int
) -> None:
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    response = await post_chunks(
        client, payload=chunk_body(chunkSize=chunk_size, chunkOverlap=chunk_overlap)
    )

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []
    # 参数错误不该占住幂等键，否则调用方改对参数后用同一个键会被判 409。
    assert await ledger_row(database) is None


async def test_unsupported_mime_is_rejected_and_releases_the_key(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(CogitoStub(b"binary"))

    rejected = await post_chunks(client, payload=chunk_body(mime="image/png", name="scan.png"))

    assert rejected.status_code == 400
    assert error_code(rejected) == errors.ErrorCode.INVALID_REQUEST
    assert "image/png" in rejected.json()["error"]["message"]
    assert await ledger_row(database) is None  # 占位已释放，同一个键还能用

    retried = await post_chunks(client, payload=chunk_body(mime="text/plain"))

    assert retried.status_code == 200


async def test_asset_larger_than_the_configured_limit_is_a_400(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(CogitoStub(b"x" * 100), asset_max_bytes=8)

    response = await post_chunks(client)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert await ledger_row(database) is None


@pytest.mark.parametrize(
    ("content_status", "expected_status", "expected_code"),
    [
        (404, 400, errors.ErrorCode.INVALID_REQUEST),
        (500, 503, errors.ErrorCode.DEPENDENCY_UNAVAILABLE),
        (429, 429, errors.ErrorCode.RATE_LIMITED),
    ],
)
async def test_cogito_failures_map_to_the_contract_codes_and_release_the_key(
    cogito_backed_client: HandlerClient,
    database: Database,
    content_status: int,
    expected_status: int,
    expected_code: errors.ErrorCode,
) -> None:
    client = cogito_backed_client(CogitoStub(content_status=content_status))

    response = await post_chunks(client)

    assert response.status_code == expected_status
    assert error_code(response) == expected_code
    if content_status == 429:
        assert response.headers["Retry-After"] == "7"
    assert await ledger_row(database) is None


async def test_database_outage_is_reported_as_retryable(offline_client: AsyncClient) -> None:
    """库没起来时既不能 500 也不能丢幂等键：cogito 应该重试而不是把实例判失败。"""
    response = await offline_client.post(
        PATH,
        json=chunk_body(),
        headers=internal_headers(idempotency_key=KEY),
    )

    assert response.status_code == 503
    assert error_code(response) == errors.ErrorCode.DEPENDENCY_UNAVAILABLE


async def test_empty_asset_is_a_success_with_zero_chunks(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """空文件合法：0 块不是错误，但不能算成功得毫无痕迹。"""
    client = cogito_backed_client(CogitoStub(b""))

    response = await post_chunks(client)

    assert response.status_code == 200
    body = response.json()
    assert body["chunkCount"] == 0
    assert body["textSha"] == hashlib.sha256(b"").hexdigest()

    chunk_set = await load_chunk_set(database, body["chunkSetID"])
    assert chunk_set is not None
    assert chunk_set.chunk_count == 0
    assert await load_chunks(database, body["chunkSetID"]) == []


async def test_defaults_come_from_settings(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(
        CogitoStub(TEXT.encode()), default_chunk_size=20, default_chunk_overlap=0
    )

    response = await post_chunks(client, payload=chunk_body())

    assert response.status_code == 200
    chunk_set = await load_chunk_set(database, response.json()["chunkSetID"])
    assert chunk_set is not None
    assert (chunk_set.chunk_size, chunk_set.chunk_overlap) == (20, 0)
    assert chunk_set.chunk_count == 3


async def test_restart_between_write_and_record_heals_in_place(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """块已落库、账本没记上：用同一个键重跑必须落在同一个块集上，而不是再建一份。"""
    client = cogito_backed_client(CogitoStub())

    first = await post_chunks(client)
    assert first.status_code == 200
    await forget_ledger(database)

    second = await post_chunks(client)

    assert second.status_code == 200
    assert second.json() == first.json()
    # 默认参数（1200/200）下整段正文就是一块；重点是「没有被写成两份」。
    assert (
        len(await load_chunks(database, first.json()["chunkSetID"])) == first.json()["chunkCount"]
    )


async def test_html_asset_is_extracted_with_the_html_extractor(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(CogitoStub(b"<p>alpha</p><p>beta</p>"))

    response = await post_chunks(client, payload=chunk_body(mime="text/html", name="page.html"))

    assert response.status_code == 200
    chunk_set = await load_chunk_set(database, response.json()["chunkSetID"])
    assert chunk_set is not None
    assert chunk_set.extractor == "html"
    assert chunk_set.source_bytes == len(b"<p>alpha</p><p>beta</p>")


async def test_ledger_uses_the_stable_endpoint_name(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """端点名是历史账本的键：跟着 URL 改等于把已完成的调用作废。"""
    client = cogito_backed_client(CogitoStub())

    await post_chunks(client)

    assert ENDPOINT == "assets.chunks"
    assert (await ledger_row(database))["status"] == "completed"


async def test_replayed_response_is_not_recomputed(
    cogito_backed_client: HandlerClient,
) -> None:
    """回放拿的是账本里存的响应体：cogito 换令牌失败也不该影响第二次调用。"""
    cogito = CogitoStub()
    client = cogito_backed_client(cogito)

    first = await post_chunks(client)
    cogito.paths.clear()

    second = await post_chunks(client)

    assert first.json() == second.json()
    assert cogito.paths == []


async def test_in_flight_key_asks_cogito_to_retry(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(CogitoStub())
    settings = make_settings()
    async with database.acquire() as connection:
        await connection.execute(
            """
            INSERT INTO idempotency_key (idempotency_key, endpoint, payload_sha, status)
                 VALUES ($1, $2, $3, 'in_progress')
            """,
            KEY,
            ENDPOINT,
            idempotency.payload_digest(
                router_payload(
                    chunk_body(),
                    chunk_size=settings.default_chunk_size,
                    chunk_overlap=settings.default_chunk_overlap,
                )
            ),
        )

    response = await post_chunks(client)

    assert response.status_code == 409
    assert response.headers["Retry-After"] == "1"


async def test_tenant_and_asset_are_passed_through_to_core(
    cogito_backed_client: HandlerClient,
) -> None:
    """令牌是按 (租户, 资产) 换的：换错租户就是跨租户读数据。"""
    seen: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == SERVICE_TOKEN_PATH:
            seen.append(("token", str(request.content)))
            return seeded_token(request)
        seen.append(("content", request.url.path))
        return httpx.Response(200, content=TEXT.encode())

    client = cogito_backed_client(handler)

    await post_chunks(client, payload=chunk_body(tenant_id="tenant-z"))

    token_request = [item for item in seen if item[0] == "token"]
    assert "tenant-z" in token_request[0][1]
    assert ASSET_ID in token_request[0][1]
    assert ("content", f"/api/v1/service/assets/{ASSET_ID}/content") in seen
