"""`POST /internal/v1/assets/{assetID}/chunks`：取正文 → 抽文本 → 切块 → 落库。

一趟走完的顺序是刻意的：

1. **先解析并校验参数**（400 不碰数据库、不碰 cogito）：请求本身就错的时候不该占幂等键，
   也不该浪费一次 cogito 的取正文调用；
2. 再进幂等闸门：重发直接回放第一次的响应；
3. 取正文、抽取、切块（纯计算，不写库）；
4. 最后**一个事务**写块集与块，然后才在幂等账本上记账。

为什么 `chunk_set_id` 由幂等键**确定性推导**（而不是随机 UUID）：最难受的故障是
「块写进库了、记账之前进程被杀」。随机 id 会让接管者另建一份块集，旧的就成了永远查不到的
垃圾；确定性 id 让重跑落到同一行上，`save()` 覆盖掉半截数据就自愈了
（见 [`compute.rag_ingest.store`]）。

正文不进响应，也不进 cogito 的编排历史：cogito 只拿到 `chunkSetID` + `chunkCount` + `textSha`，
后续嵌入与落索引都只带这个 id。
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from uuid import NAMESPACE_URL, UUID, uuid5

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors, idempotency
from compute.cogito_client import CogitoClient
from compute.db import Database, DatabaseUnavailableError
from compute.rag_ingest import chunking, extract, store
from compute.rag_ingest.schemas import ChunkRequest, ChunkResponse

logger = logging.getLogger(__name__)

CHUNK_PATH = "/internal/v1/assets/{asset_id}/chunks"
#: 幂等账本里的端点名。**不要**跟着路径改：它是历史账本的键，改了等于把已完成的调用作废。
ENDPOINT = "assets.chunks"

#: 大写是**能力挂载约定**：`app.create_app()` 只按 `ROUTER` 这个名字取路由
#: （见 `CAPABILITY_MODULES`），大小写写错就会静默少挂一个端点。
ROUTER = APIRouter()


def chunk_set_id_for(key: str, payload_sha: str) -> UUID:
    """由「幂等键 + 载荷指纹」推导块集 id。同一请求永远得到同一个 id（见模块文档）。"""
    return uuid5(NAMESPACE_URL, f"compute:{ENDPOINT}:{key}:{payload_sha}")


@dataclass(frozen=True, slots=True)
class _Document:
    """切分产物 + 落库前已知的事实。`chunks` 与 `chunk_set` 里的计数必须一致。"""

    plan: chunking.ChunkPlan
    text_sha: str
    extractor: str
    source_bytes: int


@ROUTER.post(CHUNK_PATH, summary="切分资产为块集")
async def chunk_asset(asset_id: UUID, request: Request, body: ChunkRequest) -> JSONResponse:
    """切分一个资产的正文。

    响应码：200 成功（含 0 块）；400 请求或格式问题（不支持的 MIME、正文超限、cogito 说资产
    不存在等「重试也没用」的原因）；401 内部令牌不对；409 幂等键冲突或仍在执行中；
    429 cogito 限流；503 数据库或 cogito 暂时不可用。
    """
    settings = request.app.state.settings
    chunk_size = settings.default_chunk_size if body.chunk_size is None else body.chunk_size
    chunk_overlap = (
        settings.default_chunk_overlap if body.chunk_overlap is None else body.chunk_overlap
    )
    chunking.validate_params(chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    # 幂等载荷用「生效后」的参数：省略 chunkSize 与显式写出服务端默认值必须算同一个请求，
    # 否则 cogito 的一次重发（少带一个可选字段）会被判成 409 冲突。
    payload = {
        "assetID": str(asset_id),
        "tenantID": body.tenant_id,
        "mime": body.mime,
        "name": body.name,
        "chunkSize": chunk_size,
        "chunkOverlap": chunk_overlap,
    }

    async with idempotency.guarded(request, endpoint=ENDPOINT, payload=payload) as run:
        replayed = idempotency.replay_response(run)
        if replayed is not None:
            logger.info("幂等重发，回放资产 %s 的块集结果", asset_id)
            return replayed

        document = await _build(
            request,
            asset_id=asset_id,
            body=body,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
        )
        # id 只在这一处定：幂等键与载荷指纹都取自刚占位的那次调用，重跑必然算出同一个值。
        chunk_set_id = chunk_set_id_for(run.key, run.payload_sha)
        await _persist(
            request,
            chunk_set_id=chunk_set_id,
            asset_id=asset_id,
            body=body,
            document=document,
        )

        response = ChunkResponse.from_parts(
            chunk_set_id=chunk_set_id,
            chunk_count=len(document.plan.chunks),
            text_sha=document.text_sha,
        )
        run.record(status=200, body=response.wire())
        return JSONResponse(response.wire())


async def _build(
    request: Request,
    *,
    asset_id: UUID,
    body: ChunkRequest,
    chunk_size: int,
    chunk_overlap: int,
) -> _Document:
    """取正文、抽文本、切块；只算不写库。"""
    settings = request.app.state.settings
    cogito: CogitoClient = request.app.state.cogito

    data = await cogito.asset_content(
        tenant_id=body.tenant_id,
        asset_id=str(asset_id),
        max_bytes=settings.asset_max_bytes,
    )
    extracted = extract.extract(data.data, mime=body.mime, name=body.name)
    plan = chunking.split(extracted.text, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    if not plan.chunks:
        # 不是错误（空文件、图片型 PDF 都合法），但要让运维看得见：这个资产检索不到东西。
        logger.warning(
            "资产 %s 切出 0 块（mime=%s，抽取器=%s，正文 %d 字节），该资产将检索不到内容",
            asset_id,
            body.mime,
            extracted.extractor,
            len(data.data),
        )

    return _Document(
        plan=plan,
        text_sha=hashlib.sha256(extracted.text.encode("utf-8")).hexdigest(),
        extractor=extracted.extractor,
        source_bytes=len(data.data),
    )


async def _persist(
    request: Request,
    *,
    chunk_set_id: UUID,
    asset_id: UUID,
    body: ChunkRequest,
    document: _Document,
) -> None:
    """一个事务写完块集与全部块。池没起来就是 503（可重试），不是 500。"""
    database: Database = request.app.state.db
    chunk_set = store.ChunkSet(
        chunk_set_id=chunk_set_id,
        tenant_id=body.tenant_id,
        asset_id=asset_id,
        mime=body.mime,
        name=body.name,
        text_sha=document.text_sha,
        chunk_count=len(document.plan.chunks),
        chunk_size=document.plan.chunk_size,
        chunk_overlap=document.plan.chunk_overlap,
        extractor=document.extractor,
        source_bytes=document.source_bytes,
    )
    chunks = [
        store.StoredChunk(
            ordinal=chunk.ordinal,
            text=chunk.text,
            char_start=chunk.char_start,
            char_end=chunk.char_end,
        )
        for chunk in document.plan.chunks
    ]

    try:
        async with database.acquire() as connection:
            await store.save(connection, chunk_set=chunk_set, chunks=chunks)
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc
