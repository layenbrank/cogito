"""`POST /internal/v1/assets/{assetID}/embeddings`：区间嵌入与它的重试语义。

cogito 的编排把嵌入切成一串 `[from, to)` 区间来发，而且**同一个区间可能被投递多次**
（自己重试、另一个实例接管后重发）。所以这一组盯的不是「算出了向量」，而是：

* **只补缺**：区间里已算好的 ordinal 不重算，一次上游调用都不发（`embedded=0`）；
* **不写半截**：上游响应形状不对就 503，库里干干净净，让 cogito 重试；
* **结构性问题立刻判死**：同一 `(块集, 模型)` 出现两种维度是配置问题，回 400 让 cogito
  别再重试（回 503 会把它挂在那儿无限重试）。

真库是必须的：只看响应体的话，「写了一半」「顺序写反了」「重发又写了一遍」都看不出来。
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient, Response

from compute import errors
from compute.db import Database
from compute.rag_ingest.embed import ENDPOINT
from compute.rag_ingest.schemas import EmbedResponse
from support import (
    ASSET_ID,
    TENANT_ID,
    HandlerClient,
    RagStub,
    embedding_vector,
    internal_headers,
    save_embeddings,
    seed_chunk_set,
    stored_vectors,
)

CHUNK_SET_ID = "5c2f7d5e-8a1b-4c3d-9e6f-0a1b2c3d4e5f"
OTHER_ASSET_ID = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed"
MODEL = "text-embedding-3-small"
PATH = f"/internal/v1/assets/{ASSET_ID}/embeddings"
KEY = "embed-key-0001"
DIMENSIONS = 8
TEXTS = (
    "第一块正文，讲了一件事。",
    "第二块正文，讲了另一件事。",
    "第三块正文，讲的是第三件事。",
    "第四块正文。",
)


def embed_body(
    *,
    start: int = 0,
    end: int = len(TEXTS),
    chunk_set_id: str = CHUNK_SET_ID,
    tenant_id: str = TENANT_ID,
    model: str = MODEL,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": tenant_id,
        "chunkSetID": chunk_set_id,
        "model": model,
        "from": start,
        "to": end,
    }
    payload.update(extra)
    return payload


async def post_embed(
    client: AsyncClient, *, key: str | None = KEY, payload: dict[str, Any] | None = None
) -> Response:
    return await client.post(
        PATH,
        json=embed_body() if payload is None else payload,
        headers=internal_headers(idempotency_key=key),
    )


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


async def ledger_row(database: Database, key: str = KEY) -> Any:
    async with database.acquire() as connection:
        return await connection.fetchrow(
            "SELECT status, response_status FROM idempotency_key"
            " WHERE idempotency_key = $1 AND endpoint = $2",
            key,
            ENDPOINT,
        )


async def delete_chunk(database: Database, ordinal: int, chunk_set_id: str = CHUNK_SET_ID) -> None:
    """把一块正文从库里抹掉：模拟「块集已被重新切过」时旧 id 还在被引用的窗口。"""
    async with database.acquire() as connection:
        await connection.execute(
            "DELETE FROM rag_chunk WHERE chunk_set_id = $1 AND ordinal = $2",
            UUID(chunk_set_id),
            ordinal,
        )


@pytest.fixture
async def seeded(database: Database) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)


async def test_a_range_is_embedded_in_order_and_persisted(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client)

    assert response.status_code == 200
    assert response.json() == {"from": 0, "to": 4, "embedded": 4, "dimensions": DIMENSIONS}

    vectors = await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)
    assert [ordinal for ordinal, _ in vectors] == [0, 1, 2, 3]
    # 桩故意倒序返回，所以这里顺带验了「按 index 还原顺序」。
    for (_, vector), text in zip(vectors, TEXTS, strict=True):
        assert vector == pytest.approx(embedding_vector(text, DIMENSIONS))

    # 令牌作用域带上了模型：cogito 用它是为了把嵌入算在正确的模型配额与计量上。
    assert cogito.token_bodies == [{"tenantID": TENANT_ID, "scope": "embeddings", "model": MODEL}]
    assert cogito.embed_inputs == [list(TEXTS)]


async def test_only_the_missing_ordinals_are_sent_upstream(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    first = await post_embed(client, key="embed-key-0001", payload=embed_body(end=2))
    second = await post_embed(client, key="embed-key-0002", payload=embed_body(start=2))

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json()["embedded"] == 2
    assert second.json() == {"from": 2, "to": 4, "embedded": 2, "dimensions": DIMENSIONS}
    assert cogito.embed_inputs == [list(TEXTS[:2]), list(TEXTS[2:])]
    assert len(await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)) == 4


async def test_batching_follows_the_configured_size(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito, embed_batch_size=2)

    response = await post_embed(client)

    assert response.status_code == 200
    assert cogito.embed_inputs == [list(TEXTS[:2]), list(TEXTS[2:])]
    assert response.json()["embedded"] == 4
    assert len(await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)) == 4


async def test_a_fully_embedded_range_skips_the_upstream_call(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """重发与接管后的常态：向量齐了就别再花钱算一遍。"""
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    assert (await post_embed(client, key="embed-key-0001")).status_code == 200
    again = await post_embed(client, key="embed-key-0002")

    assert again.status_code == 200
    assert again.json() == {"from": 0, "to": 4, "embedded": 0, "dimensions": DIMENSIONS}
    assert cogito.embed_calls == 1
    assert len(await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)) == 4


async def test_replaying_the_same_key_reports_zero_embedded(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """幂等命中回放首次结果，但 `embedded` 必须归零——契约里它是「**本次**写入的条数」。

    cogito 不读这个字段（它只用 `from`/`to` 对账、用 `dimensions` 判一致性），
    但库里回放一条「写了 4 条」的响应会让审计口径与事实对不上。
    """
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    first = await post_embed(client)
    second = await post_embed(client)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == {"from": 0, "to": 4, "embedded": 4, "dimensions": DIMENSIONS}
    assert second.json() == {"from": 0, "to": 4, "embedded": 0, "dimensions": DIMENSIONS}
    assert cogito.embed_calls == 1
    assert len(await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)) == 4
    assert (await ledger_row(database))["status"] == "completed"


async def test_missing_idempotency_key_is_rejected_before_touching_core(
    cogito_backed_client: HandlerClient, seeded: None
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, key=None)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []


async def test_same_key_with_a_different_range_conflicts(
    cogito_backed_client: HandlerClient, seeded: None
) -> None:
    client = cogito_backed_client(RagStub())

    assert (await post_embed(client)).status_code == 200
    response = await post_embed(client, payload=embed_body(end=2))

    assert response.status_code == 409
    assert error_code(response) == errors.ErrorCode.IDEMPOTENCY_CONFLICT


async def test_unknown_body_field_is_rejected(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """`extra="forbid"`：多出来的字段只可能是 cogito 与这里的契约版本不一致。"""
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(surprise=1))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []
    assert await ledger_row(database) is None


async def test_unknown_chunk_set_is_a_request_error_before_touching_core(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """契约里这个端点没有 404，而 cogito 重试也拿不到这个块集，所以判 400。"""
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(chunk_set_id=str(uuid4())))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert "不存在" in response.json()["error"]["message"]
    assert cogito.embed_calls == 0


@pytest.mark.parametrize(
    "payload",
    [
        embed_body(tenant_id="tenant-b"),
        embed_body(chunk_set_id=CHUNK_SET_ID[:8] + CHUNK_SET_ID[9:]),
    ],
)
async def test_a_chunk_set_outside_this_request_is_rejected(
    cogito_backed_client: HandlerClient, database: Database, seeded: None, payload: dict[str, Any]
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=payload)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.embed_calls == 0
    assert await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL) == []


async def test_a_chunk_set_of_another_asset_is_rejected(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS, asset_id=OTHER_ASSET_ID)
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client)

    assert response.status_code == 400
    assert "不属于" in response.json()["error"]["message"]
    assert cogito.embed_calls == 0


async def test_a_range_beyond_the_chunk_set_is_rejected(
    cogito_backed_client: HandlerClient, seeded: None
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(end=len(TEXTS) + 1))

    assert response.status_code == 400
    assert "超出块集范围" in response.json()["error"]["message"]
    assert cogito.embed_calls == 0


async def test_a_range_that_does_not_line_up_with_the_chunks_is_rejected(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """块号断了只可能是块集被重新切过（旧 id 还在被引用的那块窗口）。"""
    cogito = RagStub()
    client = cogito_backed_client(cogito)
    await delete_chunk(database, 1)

    response = await post_embed(client)

    assert response.status_code == 400
    assert "不连续" in response.json()["error"]["message"]
    assert cogito.embed_calls == 0


@pytest.mark.parametrize("start, end", [(2, 2), (3, 1), (0, 0)])
async def test_an_empty_or_backwards_range_is_rejected(
    cogito_backed_client: HandlerClient, database: Database, seeded: None, start: int, end: int
) -> None:
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(start=start, end=end))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert cogito.paths == []
    # 参数问题不该占住幂等键，否则调用方改对参数后用同一个键会被判 409。
    assert await ledger_row(database) is None


async def test_a_malformed_upstream_response_is_not_persisted(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """宁可整体 503 让 cogito 重试，也不要把半截向量写进库（那会变成检索时的脏数据）。"""
    cogito = RagStub(embedding_response=lambda inputs, call: {"data": []})
    client = cogito_backed_client(cogito)

    response = await post_embed(client)

    assert response.status_code == 503
    assert error_code(response) == errors.ErrorCode.DEPENDENCY_UNAVAILABLE
    assert cogito.embed_calls == 1
    assert await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL) == []
    assert await ledger_row(database) is None  # 占位已释放，同一个键还能重试


async def test_a_malformed_response_can_be_retried_with_the_same_key(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """503 之后占位必须被释放：cogito 用同一个幂等键重试时要能真正重跑，而不是拿到 409。"""

    def flaky(inputs: list[str], call: int) -> Any:
        if call == 0:
            return {"data": []}
        return {
            "data": [
                {"index": index, "embedding": embedding_vector(text, DIMENSIONS)}
                for index, text in enumerate(inputs)
            ]
        }

    client = cogito_backed_client(RagStub(embedding_response=flaky))

    failed = await post_embed(client)
    retried = await post_embed(client)

    assert failed.status_code == 503
    assert retried.status_code == 200
    assert retried.json() == {"from": 0, "to": 4, "embedded": 4, "dimensions": DIMENSIONS}
    assert len(await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)) == 4


async def test_a_dimension_switch_upstream_is_a_request_error(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """库里已有 4 维向量，上游这次给 8 维：同一索引不能混用两种维度，重试也一样。"""
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model=MODEL,
        items=[(0, embedding_vector(TEXTS[0], 4))],
    )
    cogito = RagStub(dimensions=DIMENSIONS)
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(end=2))

    assert response.status_code == 400
    assert "已有 4 维向量" in response.json()["error"]["message"]
    assert [
        ordinal
        for ordinal, _ in await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)
    ] == [0]


async def test_mixed_dimensions_already_in_the_table_are_rejected(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model=MODEL,
        items=[(0, embedding_vector(TEXTS[0], 4)), (1, embedding_vector(TEXTS[1], DIMENSIONS))],
    )
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client, payload=embed_body(end=2))

    assert response.status_code == 400
    assert "有多种维度" in response.json()["error"]["message"]
    assert cogito.embed_calls == 0


async def test_a_sibling_model_does_not_disturb_the_range(
    cogito_backed_client: HandlerClient, database: Database, seeded: None
) -> None:
    """另一个模型的向量与本次无关：维度、补齐的 ordinal 都按 (块集, 模型) 分别算。"""
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model="another-model",
        items=[(0, embedding_vector(TEXTS[0], 4)), (1, embedding_vector(TEXTS[1], 4))],
    )
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await post_embed(client)

    assert response.status_code == 200
    assert response.json()["dimensions"] == DIMENSIONS
    assert cogito.embed_inputs == [list(TEXTS)]


def test_the_wire_shape_matches_the_contract() -> None:
    """契约 `EmbedResponse` 的字段名是 `from`/`to`（Python 关键字，所以属性名另起）。"""
    body = EmbedResponse.from_parts(start=0, end=4, embedded=4, dimensions=8).wire()

    assert body == {"from": 0, "to": 4, "embedded": 4, "dimensions": 8}
    assert json.loads(json.dumps(body)) == body
