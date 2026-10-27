"""检索端点（`POST /internal/v1/rag/search`）的**行为**面。

形状与状态码的合规由 `test_contract_conformance.py` 管，这里盯的是那些会在线上悄悄出错的语义：

* **租户是硬边界**：别的租户索引过一模一样的内容，也不能出现在本租户的结果里；
* **`assetIDs` 是收窄不是提示**：传了就只在该集合里找；空数组意味着「没有可查的资产」，
  不能退化成「全租户」（那样客户端会拿到自己已经删掉的文档）；
* **模型必须一致**：用另一个模型的索引不能被检索到 —— 不同向量空间的距离没有可比性；
* **空集不是错误**：没有已索引内容时返回 200 + 空列表，调用方据此说「资料不足」；
* **只读**：同一个查询发两次得到的命中相同，且不写幂等账本。
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient, Response

from compute.rag_ingest.search import SEARCH_PATH
from support import (
    ASSET_ID,
    TENANT_ID,
    RagStub,
    internal_headers,
    seed_indexed_asset,
)

MODEL = "text-embedding-3-small"
EXACT = "退款政策是七天无理由退货。"

#: 同一租户里的第二个资产（用来验证 `assetIDs` 收窄）。
OTHER_ASSET_ID = "8f1e2d3c-4b5a-4968-8777-1a2b3c4d5e6f"
OTHER_SET_ID = "5c4d3e2f-1a0b-4c9d-8e7f-6a5b4c3d2e1f"

#: 另一个租户（同名内容，用来验证租户边界）。
FOREIGN_TENANT = "tenant-b"
FOREIGN_ASSET_ID = "1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081"
FOREIGN_SET_ID = "2c3d4e5f-6071-4829-8b3c-4d5e6f708192"


def body(**overrides: Any) -> dict[str, Any]:
    """cogito 会发来的最小检索请求。"""
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": TENANT_ID,
        "model": MODEL,
        "query": EXACT,
    }
    payload.update(overrides)
    return payload


async def search(client: AsyncClient, *, payload: dict[str, Any] | None = None) -> Response:
    return await client.post(
        SEARCH_PATH,
        json=payload if payload is not None else body(),
        headers=internal_headers(),
    )


def texts_of(response: Response) -> list[str]:
    return [hit["text"] for hit in response.json()["hits"]]


async def test_search_hits_the_closest_chunk_of_this_tenant(
    cogito_backed_client: Any, database: Any
) -> None:
    """查询文本与某一块一致时，那一块必须排第一 —— 相似度 1.0 是确定性的。"""
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=("发票在订单详情页下载。", EXACT, "运费由买家承担。"),
        model=MODEL,
    )
    stub = RagStub(dimensions=8)
    client = cogito_backed_client(stub)

    response = await search(client)

    assert response.status_code == 200
    hits = response.json()["hits"]
    assert hits, "同一租户里应有命中"
    assert hits[0]["text"] == EXACT
    assert hits[0]["assetID"] == ASSET_ID
    assert hits[0]["ordinal"] == 1
    # 只有一次嵌入调用：查询文本自己算一遍就够了
    assert stub.embedded_texts == [EXACT]


async def test_search_does_not_leak_across_tenants(
    cogito_backed_client: Any, database: Any
) -> None:
    """别的租户索引了相同内容，也不能出现在本租户的结果里。"""
    await seed_indexed_asset(
        database,
        chunk_set_id=FOREIGN_SET_ID,
        texts=(EXACT,),
        model=MODEL,
        tenant_id=FOREIGN_TENANT,
        asset_id=FOREIGN_ASSET_ID,
    )
    client = cogito_backed_client(RagStub(dimensions=8))

    response = await search(client)

    assert response.status_code == 200
    assert response.json()["hits"] == []


async def test_asset_ids_narrow_the_search(cogito_backed_client: Any, database: Any) -> None:
    """传了 `assetIDs` 就只在这些资产里找：另一个资产里更相近的块不该出现。"""
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=("发票在订单详情页下载。",),
        model=MODEL,
    )
    await seed_indexed_asset(
        database,
        chunk_set_id=OTHER_SET_ID,
        texts=(EXACT,),
        model=MODEL,
        asset_id=OTHER_ASSET_ID,
    )
    client = cogito_backed_client(RagStub(dimensions=8))

    narrowed = await search(client, payload=body(assetIDs=[ASSET_ID]))
    assert narrowed.status_code == 200
    assert [hit["assetID"] for hit in narrowed.json()["hits"]] == [ASSET_ID]

    widened = await search(client)
    assert widened.json()["hits"][0]["assetID"] == OTHER_ASSET_ID


async def test_empty_asset_ids_means_nothing_to_search(
    cogito_backed_client: Any, database: Any
) -> None:
    """空数组是「没有可查的资产」，不是「全租户」——否则客户端会拿到自己已删的文档。"""
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=(EXACT,),
        model=MODEL,
    )
    stub = RagStub(dimensions=8)
    client = cogito_backed_client(stub)

    response = await search(client, payload=body(assetIDs=[]))

    assert response.status_code == 200
    assert response.json()["hits"] == []
    # 早退在嵌入之前：没有候选就不该烧一次嵌入算力
    assert stub.embed_calls == 0


async def test_other_model_is_not_searchable(cogito_backed_client: Any, database: Any) -> None:
    """索引是用另一个模型建的：不同向量空间的距离没有可比性，必须查不到。"""
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=(EXACT,),
        model="another-embedding-model",
    )
    client = cogito_backed_client(RagStub(dimensions=8))

    response = await search(client)

    assert response.status_code == 200
    assert response.json()["hits"] == []


async def test_search_is_read_only(cogito_backed_client: Any, database: Any) -> None:
    """同一个查询发两次结果一致，且不占幂等账本（只读不该让账本随查询量膨胀）。"""
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=(EXACT,),
        model=MODEL,
    )
    client = cogito_backed_client(RagStub(dimensions=8))

    first = await search(client)
    second = await search(client)

    assert first.json() == second.json()
    async with database.acquire() as connection:
        rows = await connection.fetch("SELECT count(*) AS total FROM idempotency_key")
    assert rows[0]["total"] == 0


async def test_missing_query_is_rejected(cogito_backed_client: Any) -> None:
    """`query` 是必填：空查询没有语义，400 比返回一堆随机块更有用。"""
    client = cogito_backed_client(RagStub(dimensions=8))
    payload = body()
    payload.pop("query")

    response = await search(client, payload=payload)

    assert response.status_code == 400


async def test_top_k_caps_the_result_size(cogito_backed_client: Any, database: Any) -> None:
    await seed_indexed_asset(
        database,
        chunk_set_id="7a1c9f2e-3b4d-4c5e-8f60-1a2b3c4d5e6f",
        texts=(EXACT, "运费由买家承担。", "发票在订单详情页下载。"),
        model=MODEL,
    )
    client = cogito_backed_client(RagStub(dimensions=8))

    response = await search(client, payload=body(topK=1))

    assert response.status_code == 200
    assert len(response.json()["hits"]) == 1
    assert texts_of(response) == [EXACT]
