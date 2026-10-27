"""检索面：查询文本 → 本租户已索引块里最相近的若干块。

两个消费者共用 [`find`]：

* **服务端 agent 步**（`agent_runtime`）把它当工具内部调用，不经过 HTTP；
* **客户端知识库**（cogito `POST /api/v1/rag/search`）走本模块的端点 —— 那边是用户点「检索」
  发起的，不是模型的决定，所以必须有一个能被 cogito 调到的入口。

为什么不把向量取回 Python 再算余弦：一个租户的向量可能是几千条 × 1536 维，取回来排序既慢
又会把内存顶穿。`<=>` 是 pgvector 的余弦距离运算符，排序和截断都在库里做，只回传命中的那
几行。这里也**不**建 ANN 索引（HNSW / IVFFlat）：pgvector 要求索引列上声明维度，而
`0003_rag_embedding.sql` 刻意不声明（模型与维度是部署配置，不写死在迁移里），
`(tenant_id, asset_id)` 上的主键已经能把候选集定到一个租户；顺序扫描在本阶段的数据量下够用。

四件必须做对的事：

1. **模型与维度都要对上**：不同向量空间的距离没有可比性，所以 `model` 由调用方（cogito）指定，
   必须与 `rag.index` 落库时用的 `model` 一致；`dimensions` 再从查询向量自己的长度取，
   加进 `WHERE` 里挡掉「同一个模型、两种维度」的历史数据——否则 `<=>` 会因为维度不等直接报错；
2. **租户是硬边界**：`tenant_id` 进 `WHERE` 由数据库过滤，不是捞回来再在应用层筛；
3. **资产过滤是可选的收窄**：客户端只查自己那一批文档时传 `assetIDs`，
   省略表示「本租户全部」——过滤仍然写在 SQL 里，避免把整租户的候选捞回来再挑；
4. **只回传正文与元信息**：分数、资产 id、块号、块正文。正文是唯一会被模型读到的内容
   （截断由调用方负责）。
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from asyncpg import Connection
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors
from compute.cogito_client import CogitoClient
from compute.db import Database, DatabaseUnavailableError
from compute.providers import embeddings
from compute.rag_ingest.schemas import SearchRequest, SearchResponse

logger = logging.getLogger(__name__)

SEARCH_PATH = "/internal/v1/rag/search"
#: 端点名（只用于日志与能力归属；检索是只读，不进幂等账本）
ENDPOINT = "rag.search"

ROUTER = APIRouter()

#: 用 `ORDER BY` 里的别名 `distance` 排序，避免把 `<=>` 写两遍（那会让两边有机会写岔）。
#: 加 `i.asset_id, e.ordinal` 只是为了让**同分**时的顺序稳定：不稳定的顺序会让幂等重放
#: 拿到另一份结果，也会让测试偶发地红。
#: `$6::uuid[]` 为 NULL 时等于「本租户全部」——把「有没有过滤」收进一个参数，
#: 比在 Python 里拼两条 SQL 更不容易让两边走岔。
_SELECT_HITS = """
SELECT i.asset_id,
       e.ordinal,
       e.embedding <=> $4 AS distance,
       c.text
  FROM rag_index i
  JOIN rag_embedding e
    ON e.chunk_set_id = i.chunk_set_id AND e.model = i.model
  JOIN rag_chunk c
    ON c.chunk_set_id = e.chunk_set_id AND c.ordinal = e.ordinal
 WHERE i.tenant_id = $1
   AND i.model = $2
   AND e.dimensions = $3
   AND ($6::uuid[] IS NULL OR i.asset_id = ANY($6::uuid[]))
 ORDER BY distance, i.asset_id, e.ordinal
 LIMIT $5
"""


@dataclass(frozen=True, slots=True)
class Hit:
    """一条命中。`score` 是余弦相似度（`1 - 距离`），值域 `[-1, 1]`，越大越相近。"""

    asset_id: UUID
    ordinal: int
    score: float
    text: str


async def find(
    connection: Connection,
    cogito: CogitoClient,
    *,
    tenant_id: str,
    model: str,
    query: str,
    top_k: int,
    batch_size: int,
    asset_ids: Sequence[UUID] | None = None,
) -> list[Hit]:
    """把 `query` 嵌成向量，再在 `tenant_id` 的索引里取最相近的 `top_k` 块。

    查询用**同一枚** `scope=embeddings` 令牌回打 cogito：嵌入算力的唯一出口仍然是 cogito 的网关，
    这里不另开一条路。嵌入响应的形状校验在 `providers.embeddings`（形状不对 → 503 可重试）。

    `asset_ids` 为空列表时按「什么都没有」处理（返回空集），而不是退化成「全租户」——
    调用方筛完发现没有可查的资产时，想要的答案就是空。
    """
    if asset_ids is not None and not asset_ids:
        return []

    batch = await embeddings.embed_texts(
        cogito, tenant_id=tenant_id, model=model, texts=[query], batch_size=batch_size
    )
    if not batch.vectors:  # pragma: no cover - 空输入在上面就被调用方拦住了
        return []

    rows = await connection.fetch(
        _SELECT_HITS,
        tenant_id,
        model,
        batch.dimensions,
        list(batch.vectors[0]),
        top_k,
        None if asset_ids is None else list(asset_ids),
    )
    return [
        Hit(
            asset_id=row["asset_id"],
            ordinal=row["ordinal"],
            score=1.0 - float(row["distance"]),
            text=row["text"],
        )
        for row in rows
    ]


@ROUTER.post(SEARCH_PATH, summary="按查询文本检索本租户已索引的块")
async def search(request: Request, body: SearchRequest) -> JSONResponse:
    """检索一个租户（可选收窄到若干资产）里最相近的块。

    响应码：200 成功（含空集）；400 请求本身有问题；401 内部令牌不对；429 cogito 限流；
    503 数据库或嵌入侧暂时不可用。**只读**，因此不进幂等账本：重发同一查询不该占键，
    也不该让账本随查询量膨胀。
    """
    database: Database = request.app.state.db
    cogito: CogitoClient = request.app.state.cogito
    settings = request.app.state.settings

    try:
        async with database.acquire() as connection:
            hits = await find(
                connection,
                cogito,
                tenant_id=body.tenant_id,
                model=body.model,
                query=body.query,
                top_k=body.top_k,
                batch_size=settings.embed_batch_size,
                asset_ids=body.asset_ids,
            )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc

    return JSONResponse(SearchResponse.from_hits(hits).wire())
