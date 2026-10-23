"""检索面：查询文本 → 本租户已索引块里最相近的若干块（P9b 的工具用它，**不开端点**）。

为什么不把向量取回 Python 再算余弦：一个租户的向量可能是几千条 × 1536 维，取回来排序既慢
又会把内存顶穿。`<=>` 是 pgvector 的余弦距离运算符，排序和截断都在库里做，只回传命中的那
几行。这里也**不**建 ANN 索引（HNSW / IVFFlat）：pgvector 要求索引列上声明维度，而
`0003_rag_embedding.sql` 刻意不声明（模型与维度是部署配置，不写死在迁移里），
`(tenant_id, asset_id)` 上的主键已经能把候选集定到一个租户；顺序扫描在本阶段的数据量下够用。

三件必须做对的事：

1. **模型与维度都要对上**：不同向量空间的距离没有可比性，所以 `model` 由调用方（cogito）指定，
   必须与 `rag.index` 落库时用的 `model` 一致；`dimensions` 再从查询向量自己的长度取，
   加进 `WHERE` 里挡掉「同一个模型、两种维度」的历史数据——否则 `<=>` 会因为维度不等直接报错；
2. **租户是硬边界**：`tenant_id` 进 `WHERE` 由数据库过滤，不是捞回来再在应用层筛；
3. **只回传正文与元信息**：分数、资产 id、块号、块正文。正文是唯一会被模型读到的内容
   （截断由调用方负责）。
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from asyncpg import Connection

from compute.cogito_client import CogitoClient
from compute.providers import embeddings

#: 用 `ORDER BY` 里的别名 `distance` 排序，避免把 `<=>` 写两遍（那会让两边有机会写岔）。
#: 加 `i.asset_id, e.ordinal` 只是为了让**同分**时的顺序稳定：不稳定的顺序会让幂等重放
#: 拿到另一份结果，也会让测试偶发地红。
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
) -> list[Hit]:
    """把 `query` 嵌成向量，再在 `tenant_id` 的索引里取最相近的 `top_k` 块。

    查询用**同一枚** `scope=embeddings` 令牌回打 cogito：嵌入算力的唯一出口仍然是 cogito 的网关，
    这里不另开一条路。嵌入响应的形状校验在 `providers.embeddings`（形状不对 → 503 可重试）。
    """
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
