"""`POST /internal/v1/assets/{assetID}/embeddings`：为块集的一个区间补向量。

cogito 把嵌入切成 `[from, to)` 区间来发（见 `apps/service/src/orchestrations/rag.rs`），所以这里的
口径必须跟它的重试语义对齐：

* 区间内的向量**已经全有** → 一次上游调用都不发，`embedded=0`（重发与接管后的常态）；
* 只补缺的那些 ordinal，算完一个事务写库，`embedded` 是本次真正写入的条数；
* 上游响应形状不对 → 503 让 cogito 重试，绝不写半截（理由见 `providers.embeddings`）；
* 但「同一个 (块集, 模型) 出现两种维度」是结构性问题（上游换了模型/灰度切流），回 400 让 cogito
  立刻判定永久失败，而不是拿 503 把它挂在那儿无限重试。

**块集不存在或不属于这个资产也回 400**：契约里这个端点没有 404，而且对 cogito 来说
「重试也拿不到这个块集」就是请求问题。

幂等命中时回放的响应里 `embedded` 会被改写成 0 —— 契约对它的定义是「**本次**实际写入的
向量数」，重放这次一条都没写。cogito 只用 `from`/`to` 对账、用 `dimensions` 判一致性，
不读 `embedded`，所以这个改写对它无影响。
"""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors, idempotency
from compute.cogito_client import CogitoClient
from compute.db import Database, DatabaseUnavailableError
from compute.providers import embeddings
from compute.rag_ingest import store
from compute.rag_ingest.schemas import EmbedRequest, EmbedResponse

logger = logging.getLogger(__name__)

EMBED_PATH = "/internal/v1/assets/{asset_id}/embeddings"
#: 幂等账本里的端点名。**不要**跟着路径改：它是历史账本的键，改了等于把已完成的调用作废。
ENDPOINT = "assets.embeddings"

ROUTER = APIRouter()


@ROUTER.post(EMBED_PATH, summary="为块集的区间算嵌入")
async def embed_range(asset_id: UUID, request: Request, body: EmbedRequest) -> JSONResponse:
    """补齐一个区间的向量。

    响应码：200 成功（含「一条都没补」）；400 请求或归属/维度问题；401 内部令牌不对；
    409 幂等键冲突或仍在执行中；429 cogito 限流；503 数据库或 cogito 暂时不可用。
    """
    payload = {
        "assetID": str(asset_id),
        "tenantID": body.tenant_id,
        "chunkSetID": str(body.chunk_set_id),
        "model": body.model,
        "from": body.start,
        "to": body.end,
    }

    async with idempotency.guarded(request, endpoint=ENDPOINT, payload=payload) as run:
        if run.replay is not None:
            logger.info(
                "幂等重发，回放资产 %s 区间 [%d, %d) 的嵌入结果",
                asset_id,
                body.start,
                body.end,
            )
            # 只改 embedded：其余字段（from/to/dimensions）必须与首次一致，cogito 拿它们对账。
            return JSONResponse({**run.replay.body, "embedded": 0}, status_code=run.replay.status)

        response = await _embed(request, asset_id=asset_id, body=body)
        run.record(status=200, body=response.wire())
        return JSONResponse(response.wire())


async def _embed(request: Request, *, asset_id: UUID, body: EmbedRequest) -> EmbedResponse:
    """先读（不调 cogito），缺哪块算哪块，最后写。"""
    settings = request.app.state.settings
    cogito: CogitoClient = request.app.state.cogito
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

            chunks = await store.load_chunks(
                connection,
                chunk_set_id=body.chunk_set_id,
                start=body.start,
                end=body.end,
            )
            existing = await store.load_embeddings(
                connection,
                chunk_set_id=body.chunk_set_id,
                model=body.model,
                start=body.start,
                end=body.end,
            )
            recorded = await store.load_dimensions(
                connection, chunk_set_id=body.chunk_set_id, model=body.model
            )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc

    expected = list(range(body.start, body.end))
    if body.end > chunk_set.chunk_count:
        message = f"区间 [{body.start}, {body.end}) 超出块集范围（共 {chunk_set.chunk_count} 块）"
        raise errors.invalid_request(message)
    if [chunk.ordinal for chunk in chunks] != expected:
        # 块号不连续只可能是块集被重新切过（旧 id 还在被引用的那块窗口）。
        message = (
            f"块集 {body.chunk_set_id} 的区间 [{body.start}, {body.end}) 块号不连续，"
            "该块集已被重新切分，请重新提交切块请求"
        )
        raise errors.invalid_request(message)
    if len(recorded) > 1:
        message = (
            f"块集 {body.chunk_set_id} 在模型 {body.model} 下的向量有多种维度 "
            f"{sorted(recorded)}，请换一个块集重新嵌入"
        )
        raise errors.invalid_request(message)

    dimensions = next(iter(recorded), None)
    done = {item.ordinal for item in existing}
    missing = [chunk for chunk in chunks if chunk.ordinal not in done]

    if not missing:
        if dimensions is None:  # pragma: no cover - 已有向量却读不到维度只可能是库被手改过
            raise errors.internal_error("块集里已有向量却读不到维度，数据库状态异常")
        logger.info(
            "资产 %s 区间 [%d, %d) 的向量已齐全，跳过上游调用", asset_id, body.start, body.end
        )
        return EmbedResponse.from_parts(
            start=body.start, end=body.end, embedded=0, dimensions=dimensions
        )

    batch = await embeddings.embed_texts(
        cogito,
        tenant_id=body.tenant_id,
        model=body.model,
        texts=[chunk.text for chunk in missing],
        batch_size=settings.embed_batch_size,
    )
    if dimensions is not None and dimensions != batch.dimensions:
        message = (
            f"块集 {body.chunk_set_id} 在模型 {body.model} 下已有 {dimensions} 维向量，"
            f"本次上游给出 {batch.dimensions} 维；同一索引里不能混用两种维度，"
            "请确认 cogito 侧的嵌入模型配置"
        )
        raise errors.invalid_request(message)

    try:
        async with database.acquire() as connection:
            await store.save_embeddings(
                connection,
                chunk_set_id=body.chunk_set_id,
                model=body.model,
                dimensions=batch.dimensions,
                items=[
                    (chunk.ordinal, vector)
                    for chunk, vector in zip(missing, batch.vectors, strict=True)
                ],
            )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc

    logger.info(
        "资产 %s 区间 [%d, %d) 写入 %d 条 %d 维向量",
        asset_id,
        body.start,
        body.end,
        len(missing),
        batch.dimensions,
    )
    return EmbedResponse.from_parts(
        start=body.start, end=body.end, embedded=len(missing), dimensions=batch.dimensions
    )
