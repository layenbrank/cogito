"""`PUT /internal/v1/assets/{assetID}/index`：把块集的当前版本物化进检索索引。

这一步是 cogito 编排的**收尾**：`rag.index-asset` 无论切出多少块都会走到这里（0 块也走），
因为「资产不再检索到旧内容」和「资产能检索到新内容」同等重要 —— 索引里的旧版本必须被替换，
而不是并存。

本实现的索引就是数据库里的两件事：`rag_index` 的当前版本行 + 该块集在 `rag_embedding` 里的
向量。所以这一步不调上游、只做校验与记账：

* **向量必须齐全**（每个 ordinal 都有向量），否则 400 并指出第一个缺口 —— 缺向量时
  「建索引成功」会变成检索时才发现问题；
* `chunkCount` 必须与块集的块数一致（cogito 传错说明它拿的块集和我们的不是同一份）；
* `dimensions` 必须与已有向量一致，否则 400（同一索引不能混用两种维度）；
* 0 块的资产 `chunkCount=0`、`dimensions=0`，此时没有任何向量要校验，照样把旧版本替换掉。

`collection` 的粒度是**单资产**（`asset-<assetID>`）：一个资产一份当前版本，检索时按
`tenantID` + `assetID` 定位，不需要在集合层面再做隔离。要改成「租户一集合」只需要改
`collection_for`（向量表里已经有 `tenant_id`，不需要迁移数据）。
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors, idempotency
from compute.db import Database, DatabaseUnavailableError
from compute.rag_ingest import store
from compute.rag_ingest.schemas import IndexRequest, IndexResponse

logger = logging.getLogger(__name__)

INDEX_PATH = "/internal/v1/assets/{asset_id}/index"
#: 幂等账本里的端点名。**不要**跟着路径改：它是历史账本的键，改了等于把已完成的调用作废。
ENDPOINT = "assets.index"

ROUTER = APIRouter()


def collection_for(asset_id: UUID) -> str:
    """检索集合名。契约的 `collection` 只是回执，但要稳定、可逆、不暴露租户信息。"""
    return f"asset-{asset_id}"


@ROUTER.put(INDEX_PATH, summary="物化块集为资产的检索索引")
async def upsert_index(asset_id: UUID, request: Request, body: IndexRequest) -> JSONResponse:
    """替换某个资产的索引版本。

    响应码：200 成功；400 请求或归属/完整性问题；401 内部令牌不对；409 幂等键冲突或仍在
    执行中；503 数据库暂时不可用。**这个端点不调 cogito**，所以不会有 429。
    """
    payload = {
        "assetID": str(asset_id),
        "tenantID": body.tenant_id,
        "chunkSetID": str(body.chunk_set_id),
        "chunkCount": body.chunk_count,
        "model": body.model,
        "dimensions": body.dimensions,
    }

    async with idempotency.guarded(request, endpoint=ENDPOINT, payload=payload) as run:
        replayed = idempotency.replay_response(run)
        if replayed is not None:
            # 原样回放：契约要求幂等命中「返回首次结果，不叠加」。
            logger.info("幂等重发，回放资产 %s 的索引结果", asset_id)
            return replayed

        response = await _index(request, asset_id=asset_id, body=body)
        run.record(status=200, body=response.wire())
        return JSONResponse(response.wire())


async def _index(request: Request, *, asset_id: UUID, body: IndexRequest) -> IndexResponse:
    database: Database = request.app.state.db

    try:
        async with database.acquire() as connection:
            chunk_set = await store.load(connection, chunk_set_id=body.chunk_set_id)
            if chunk_set is None:
                message = f"chunkSetID={body.chunk_set_id} 不存在，请先切分该资产"
                raise errors.invalid_request(message)
            if chunk_set.tenant_id != body.tenant_id or chunk_set.asset_id != asset_id:
                message = (
                    f"chunkSetID={body.chunk_set_id} 不属于租户 {body.tenant_id} 的资产 {asset_id}"
                )
                raise errors.invalid_request(message)
            if body.chunk_count != chunk_set.chunk_count:
                message = (
                    f"chunkCount={body.chunk_count} 与块集 {body.chunk_set_id} 实际的 "
                    f"{chunk_set.chunk_count} 块不一致"
                )
                raise errors.invalid_request(message)

            vectors = await store.load_embeddings(
                connection, chunk_set_id=body.chunk_set_id, model=body.model
            )
            recorded = await store.load_dimensions(
                connection, chunk_set_id=body.chunk_set_id, model=body.model
            )
            _require_complete_vectors(body, vectors=vectors)
            _require_matching_dimensions(body, recorded=recorded)

            await store.save_index(
                connection,
                entry=store.IndexEntry(
                    tenant_id=body.tenant_id,
                    asset_id=asset_id,
                    chunk_set_id=body.chunk_set_id,
                    model=body.model,
                    dimensions=body.dimensions,
                    chunk_count=body.chunk_count,
                    collection=collection_for(asset_id),
                ),
            )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc

    logger.info(
        "资产 %s 的索引已指向块集 %s（%d 块，%d 维，模型 %s）",
        asset_id,
        body.chunk_set_id,
        body.chunk_count,
        body.dimensions,
        body.model,
    )
    return IndexResponse.from_parts(indexed=body.chunk_count, collection=collection_for(asset_id))


def _require_complete_vectors(body: IndexRequest, *, vectors: list[store.StoredVector]) -> None:
    """每个 ordinal 都要有向量；0 块的块集天然通过（`range(0)` 是空的）。"""
    have = {item.ordinal for item in vectors}
    missing = [ordinal for ordinal in range(body.chunk_count) if ordinal not in have]
    extra = sorted(ordinal for ordinal in have if ordinal >= body.chunk_count)
    if missing or extra:
        detail = []
        if missing:
            detail.append(f"缺 ordinal={missing[0]}（共缺 {len(missing)} 块）")
        if extra:
            detail.append(f"多出块集之外的 ordinal={extra}")
        message = (
            f"块集 {body.chunk_set_id} 在模型 {body.model} 下的向量不完整：{'；'.join(detail)}；"
            "请先调用 embeddings 端点补齐"
        )
        raise errors.invalid_request(message)


def _require_matching_dimensions(body: IndexRequest, *, recorded: set[int]) -> None:
    if len(recorded) > 1:
        message = (
            f"块集 {body.chunk_set_id} 在模型 {body.model} 下的向量有多种维度 "
            f"{sorted(recorded)}，请换一个块集重新嵌入"
        )
        raise errors.invalid_request(message)
    if recorded and body.dimensions not in recorded:
        message = (
            f"请求声明 {body.dimensions} 维，但块集 {body.chunk_set_id} 里的向量是 "
            f"{next(iter(recorded))} 维；同一索引不能混用两种维度"
        )
        raise errors.invalid_request(message)
