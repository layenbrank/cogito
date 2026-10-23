"""`PUT /internal/v1/assets/{assetID}/index`：把块集的当前版本物化进检索索引。

这一步是 cogito 编排 `rag.index-asset` 的**收尾**，而且**空块集也会走到这里** —— 资产变成
「无可检索内容」和资产变成「有新内容」同等重要，索引里的旧版本必须被替换掉。

所以这一组盯三件事：

* **一遍做完才认**：向量不齐就 400 并指出第一个缺口，绝不留下「看起来建好了」的索引；
* **旧版本被替换**：一个资产永远只有一行，0 块的资产也能把旧行顶掉（不是并存）；
* **不调上游**：这个端点只做校验与记账，cogito 也不会因为这里去等一个模型。

真库同样是必须的：`rag_index` 的「一行」性质是靠主键与 upsert 保证的，假库验不出来。
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from httpx import AsyncClient, Response

from compute import errors
from compute.db import Database
from compute.rag_ingest.index import ENDPOINT, collection_for
from compute.rag_ingest.schemas import IndexResponse
from support import (
    ASSET_ID,
    TENANT_ID,
    HandlerClient,
    RagStub,
    embedding_vector,
    internal_headers,
    save_embeddings,
    seed_chunk_set,
    stored_index_count,
    stored_index_row,
    stored_vectors,
)

CHUNK_SET_ID = "5c2f7d5e-8a1b-4c3d-9e6f-0a1b2c3d4e5f"
EMPTY_CHUNK_SET_ID = "0d1f9a44-6f2c-4a55-9c8d-77e9e5b3a102"
NEW_CHUNK_SET_ID = "b2c3d4e5-f607-4a18-9c2d-3e4f5a6b7c8d"
MODEL = "text-embedding-3-small"
PATH = f"/internal/v1/assets/{ASSET_ID}/index"
KEY = "index-key-0001"
DIMENSIONS = 8
COLLECTION = collection_for(UUID(ASSET_ID))
TEXTS = ("第一块正文。", "第二块正文。", "第三块正文。")


def index_body(
    *,
    chunk_set_id: str = CHUNK_SET_ID,
    chunk_count: int = len(TEXTS),
    dimensions: int = DIMENSIONS,
    tenant_id: str = TENANT_ID,
    model: str = MODEL,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": tenant_id,
        "chunkSetID": chunk_set_id,
        "chunkCount": chunk_count,
        "model": model,
        "dimensions": dimensions,
    }
    payload.update(extra)
    return payload


async def put_index(
    client: AsyncClient, *, key: str | None = KEY, payload: dict[str, Any] | None = None
) -> Response:
    return await client.put(
        PATH,
        json=index_body() if payload is None else payload,
        headers=internal_headers(idempotency_key=key),
    )


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


async def embed_all(database: Database, *, chunk_set_id: str = CHUNK_SET_ID) -> None:
    """把块集的向量补齐（直接写库：这一组要验的是索引，不是嵌入）。"""
    await save_embeddings(
        database,
        chunk_set_id=chunk_set_id,
        model=MODEL,
        items=[(ordinal, embedding_vector(text, DIMENSIONS)) for ordinal, text in enumerate(TEXTS)],
    )


async def test_one_call_materialises_the_current_version(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    cogito = RagStub()
    client = cogito_backed_client(cogito)

    response = await put_index(client)

    assert response.status_code == 200
    assert response.json() == {"indexed": 3, "collection": COLLECTION}

    row = await stored_index_row(database)
    assert row is not None
    assert row["chunk_set_id"] == UUID(CHUNK_SET_ID)
    assert row["model"] == MODEL
    assert row["dimensions"] == DIMENSIONS
    assert row["chunk_count"] == len(TEXTS)
    assert row["collection"] == COLLECTION
    # 这个端点不碰 cogito：连令牌都不用换。
    assert cogito.paths == []


async def test_vectors_must_be_complete_and_the_gap_is_named(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """缺向量时「建索引成功」会在检索时才暴露，宁可在这一步指名道姓地拒绝。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model=MODEL,
        items=[(0, embedding_vector(TEXTS[0], DIMENSIONS))],
    )
    client = cogito_backed_client(RagStub())

    response = await put_index(client)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert "缺 ordinal=1" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_an_asset_with_no_chunks_still_replaces_the_previous_version(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """资产被清空（空文件、全是图片的 PDF）也要走这一步：不替换的话旧内容还能被检索到。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    await seed_chunk_set(database, chunk_set_id=EMPTY_CHUNK_SET_ID, texts=())
    client = cogito_backed_client(RagStub())

    first = await put_index(client, key="index-key-0001")
    emptied = await put_index(
        client,
        key="index-key-0002",
        payload=index_body(chunk_set_id=EMPTY_CHUNK_SET_ID, chunk_count=0, dimensions=0),
    )

    assert (first.status_code, emptied.status_code) == (200, 200)
    assert emptied.json() == {"indexed": 0, "collection": COLLECTION}
    row = await stored_index_row(database)
    assert row is not None
    assert row["chunk_set_id"] == UUID(EMPTY_CHUNK_SET_ID)
    assert row["chunk_count"] == 0
    # 「替换」不是「并存」：一个资产永远只有一行。
    assert await stored_index_count(database) == 1


async def test_re_indexing_a_narrower_chunk_set_keeps_one_row(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    await seed_chunk_set(database, chunk_set_id=NEW_CHUNK_SET_ID, texts=TEXTS[:1])
    await save_embeddings(
        database,
        chunk_set_id=NEW_CHUNK_SET_ID,
        model=MODEL,
        items=[(0, embedding_vector(TEXTS[0], DIMENSIONS))],
    )
    client = cogito_backed_client(RagStub())

    await put_index(client, key="index-key-0001")
    again = await put_index(
        client,
        key="index-key-0002",
        payload=index_body(chunk_set_id=NEW_CHUNK_SET_ID, chunk_count=1),
    )

    assert again.status_code == 200
    assert again.json() == {"indexed": 1, "collection": COLLECTION}
    assert await stored_index_count(database) == 1
    row = await stored_index_row(database)
    assert row is not None
    assert row["chunk_set_id"] == UUID(NEW_CHUNK_SET_ID)


async def test_replaying_the_same_key_returns_the_first_result(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    client = cogito_backed_client(RagStub())

    first = await put_index(client)
    second = await put_index(client)

    assert (first.status_code, second.status_code) == (200, 200)
    assert first.json() == second.json() == {"indexed": 3, "collection": COLLECTION}
    assert await stored_index_count(database) == 1


async def test_missing_idempotency_key_is_rejected(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    client = cogito_backed_client(RagStub())

    response = await put_index(client, key=None)

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST
    assert await stored_index_row(database) is None


async def test_same_key_with_a_different_chunk_count_conflicts(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    client = cogito_backed_client(RagStub())

    assert (await put_index(client)).status_code == 200
    response = await put_index(client, payload=index_body(chunk_count=2))

    assert response.status_code == 409
    assert error_code(response) == errors.ErrorCode.IDEMPOTENCY_CONFLICT


async def test_unknown_chunk_set_is_a_request_error(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    client = cogito_backed_client(RagStub())

    response = await put_index(client, payload=index_body(chunk_set_id=str(uuid4())))

    assert response.status_code == 400
    assert "不存在" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_a_chunk_set_of_another_asset_is_rejected(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS, tenant_id="tenant-b")
    client = cogito_backed_client(RagStub())

    response = await put_index(client)

    assert response.status_code == 400
    assert "不属于" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_a_chunk_count_that_disagrees_with_the_chunk_set_is_rejected(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """cogito 传错块数说明它手里那份块集与我们的不是同一份，绝不能照单建索引。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    client = cogito_backed_client(RagStub())

    response = await put_index(client, payload=index_body(chunk_count=5))

    assert response.status_code == 400
    assert "不一致" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_declared_dimensions_must_match_the_stored_vectors(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    client = cogito_backed_client(RagStub())

    response = await put_index(client, payload=index_body(dimensions=4))

    assert response.status_code == 400
    assert "不能混用两种维度" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_vectors_from_another_model_do_not_count(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """向量是按 (块集, 模型) 存的：另一个模型的向量不能拿来给这个模型建索引。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model="another-model",
        items=[(ordinal, embedding_vector(text, DIMENSIONS)) for ordinal, text in enumerate(TEXTS)],
    )
    client = cogito_backed_client(RagStub())

    response = await put_index(client)

    assert response.status_code == 400
    assert "向量不完整" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


async def test_vectors_beyond_the_chunk_count_are_rejected(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """多出块集之外的 ordinal：块集与向量对不上，建了索引也只会检索出孤儿块。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS[:2])
    await save_embeddings(
        database,
        chunk_set_id=CHUNK_SET_ID,
        model=MODEL,
        items=[(ordinal, embedding_vector(text, DIMENSIONS)) for ordinal, text in enumerate(TEXTS)],
    )
    client = cogito_backed_client(RagStub())

    response = await put_index(client, payload=index_body(chunk_count=2))

    assert response.status_code == 400
    assert "多出块集之外的 ordinal" in response.json()["error"]["message"]
    assert await stored_index_row(database) is None


def test_the_collection_name_is_stable_and_per_asset() -> None:
    assert collection_for(UUID(ASSET_ID)) == f"asset-{ASSET_ID}"
    assert collection_for(UUID(ASSET_ID)) == collection_for(UUID(ASSET_ID))
    assert collection_for(UUID(ASSET_ID)) == COLLECTION


def test_the_wire_shape_matches_the_contract() -> None:
    assert IndexResponse.from_parts(indexed=3, collection=COLLECTION).wire() == {
        "indexed": 3,
        "collection": COLLECTION,
    }


def test_the_ledger_uses_a_stable_endpoint_name() -> None:
    """账本里的端点名是历史键，改了等于把已完成的调用作废。"""
    assert ENDPOINT == "assets.index"


async def test_stored_vectors_are_readable_after_indexing(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """索引只是记录「当前版本」，向量本身照旧留在 `rag_embedding`（检索面要用）。"""
    await seed_chunk_set(database, chunk_set_id=CHUNK_SET_ID, texts=TEXTS)
    await embed_all(database)
    client = cogito_backed_client(RagStub())

    await put_index(client)

    vectors = await stored_vectors(database, chunk_set_id=CHUNK_SET_ID, model=MODEL)
    assert [ordinal for ordinal, _ in vectors] == [0, 1, 2]
