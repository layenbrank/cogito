"""块集、向量与索引当前版本的读写。正文只落在这里，cogito 侧只持有 `chunkSetID`。

写入是**按 `chunk_set_id` 幂等**的：`chunk_set_id` 由幂等键确定性地推导（见
[`compute.rag_ingest.router.chunk_set_id_for`]），所以同一个键重跑不会产生第二份块集，
也不会把块写成两份。这解决的是「进程在写库和记账之间被杀掉」这种最难查的情况：
下次接管时重算出的 id 一模一样，`save()` 覆盖掉半截数据，`textSha` 也就对得上。

向量与索引沿用同一条幂等思路：向量按 `(chunk_set_id, ordinal, model)` upsert，索引按
`(tenant_id, asset_id)` upsert（一个资产只有一份当前版本）。**读向量时这里只读
`ordinal` / `dimensions`，不读向量本身** —— 这一层关心的是「嵌没嵌、维度多少」，
把向量取回内存是检索面（P8）的事。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from uuid import UUID

from asyncpg import Connection

_INSERT_SET = """
INSERT INTO rag_chunk_set (
    chunk_set_id, tenant_id, asset_id, mime, name,
    text_sha, chunk_count, chunk_size, chunk_overlap, extractor, source_bytes
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (chunk_set_id) DO NOTHING
"""

_INSERT_CHUNK = """
INSERT INTO rag_chunk (chunk_set_id, ordinal, text, char_start, char_end)
VALUES ($1, $2, $3, $4, $5)
"""

_SELECT_SET = """
SELECT chunk_set_id, tenant_id, asset_id, mime, name, text_sha,
       chunk_count, chunk_size, chunk_overlap, extractor, source_bytes
  FROM rag_chunk_set
 WHERE chunk_set_id = $1
"""

_SELECT_CHUNKS = """
SELECT ordinal, text, char_start, char_end
  FROM rag_chunk
 WHERE chunk_set_id = $1 AND ordinal >= $2 AND ($3::integer IS NULL OR ordinal < $3)
 ORDER BY ordinal
"""

_SELECT_EMBEDDINGS = """
SELECT ordinal, dimensions
  FROM rag_embedding
 WHERE chunk_set_id = $1 AND model = $2 AND ordinal >= $3
   AND ($4::integer IS NULL OR ordinal < $4)
 ORDER BY ordinal
"""

_SELECT_EMBEDDING_DIMENSIONS = """
SELECT DISTINCT dimensions
  FROM rag_embedding
 WHERE chunk_set_id = $1 AND model = $2
"""

_UPSERT_EMBEDDING = """
INSERT INTO rag_embedding (chunk_set_id, ordinal, model, dimensions, embedding)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (chunk_set_id, ordinal, model) DO UPDATE
   SET dimensions = EXCLUDED.dimensions,
       embedding = EXCLUDED.embedding,
       created_at = now()
"""

_UPSERT_INDEX = """
INSERT INTO rag_index (
    tenant_id, asset_id, chunk_set_id, model, dimensions, chunk_count, collection
) VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (tenant_id, asset_id) DO UPDATE
   SET chunk_set_id = EXCLUDED.chunk_set_id,
       model = EXCLUDED.model,
       dimensions = EXCLUDED.dimensions,
       chunk_count = EXCLUDED.chunk_count,
       collection = EXCLUDED.collection,
       indexed_at = now()
"""


@dataclass(frozen=True, slots=True)
class ChunkSet:
    """一个块集的元数据（不含正文）。"""

    chunk_set_id: UUID
    tenant_id: str
    asset_id: UUID
    mime: str
    name: str | None
    text_sha: str
    chunk_count: int
    chunk_size: int
    chunk_overlap: int
    extractor: str
    source_bytes: int


@dataclass(frozen=True, slots=True)
class StoredChunk:
    """一块正文（读回来时用）。"""

    ordinal: int
    text: str
    char_start: int
    char_end: int


@dataclass(frozen=True, slots=True)
class StoredVector:
    """一条已入库向量的**元信息**（不回读向量本身，见模块文档）。"""

    ordinal: int
    dimensions: int


@dataclass(frozen=True, slots=True)
class IndexEntry:
    """索引里的当前版本（一个资产一行）。"""

    tenant_id: str
    asset_id: UUID
    chunk_set_id: UUID
    model: str
    dimensions: int
    chunk_count: int
    collection: str


async def save(
    connection: Connection,
    *,
    chunk_set: ChunkSet,
    chunks: list[StoredChunk],
) -> None:
    """整体落库：元数据 + 全部块，一个事务，可重复执行。"""
    async with connection.transaction():
        await connection.execute(
            _INSERT_SET,
            chunk_set.chunk_set_id,
            chunk_set.tenant_id,
            chunk_set.asset_id,
            chunk_set.mime,
            chunk_set.name,
            chunk_set.text_sha,
            chunk_set.chunk_count,
            chunk_set.chunk_size,
            chunk_set.chunk_overlap,
            chunk_set.extractor,
            chunk_set.source_bytes,
        )
        # 可能是重跑：先把上一次留下的块清掉，再整批写，避免 ordinal 撞主键或残留旧块。
        await connection.execute(
            "DELETE FROM rag_chunk WHERE chunk_set_id = $1", chunk_set.chunk_set_id
        )
        if chunks:
            await connection.executemany(
                _INSERT_CHUNK,
                [
                    (
                        chunk_set.chunk_set_id,
                        chunk.ordinal,
                        chunk.text,
                        chunk.char_start,
                        chunk.char_end,
                    )
                    for chunk in chunks
                ],
            )


async def load(connection: Connection, *, chunk_set_id: UUID) -> ChunkSet | None:
    row = await connection.fetchrow(_SELECT_SET, chunk_set_id)
    if row is None:
        return None
    return ChunkSet(
        chunk_set_id=row["chunk_set_id"],
        tenant_id=row["tenant_id"],
        asset_id=row["asset_id"],
        mime=row["mime"],
        name=row["name"],
        text_sha=row["text_sha"],
        chunk_count=row["chunk_count"],
        chunk_size=row["chunk_size"],
        chunk_overlap=row["chunk_overlap"],
        extractor=row["extractor"],
        source_bytes=row["source_bytes"],
    )


async def load_chunks(
    connection: Connection,
    *,
    chunk_set_id: UUID,
    start: int = 0,
    end: int | None = None,
) -> list[StoredChunk]:
    """按 `[start, end)` 读块（P6b-4 的嵌入分批就靠这个区间，序号必须稳定）。"""
    rows = await connection.fetch(_SELECT_CHUNKS, chunk_set_id, start, end)
    return [
        StoredChunk(
            ordinal=row["ordinal"],
            text=row["text"],
            char_start=row["char_start"],
            char_end=row["char_end"],
        )
        for row in rows
    ]


async def load_embeddings(
    connection: Connection,
    *,
    chunk_set_id: UUID,
    model: str,
    start: int = 0,
    end: int | None = None,
) -> list[StoredVector]:
    """该模型在 `[start, end)` 内**已经算好**的向量，按 ordinal 升序。

    调用方拿它做两件事：找出还缺哪些 ordinal（只补缺的，不重算），以及确认区间内的
    块与向量一一对应（块集被重切过时这里会缺号，属于请求问题）。
    """
    rows = await connection.fetch(_SELECT_EMBEDDINGS, chunk_set_id, model, start, end)
    return [StoredVector(ordinal=row["ordinal"], dimensions=row["dimensions"]) for row in rows]


async def load_dimensions(connection: Connection, *, chunk_set_id: UUID, model: str) -> set[int]:
    """该模型在这个块集上已用过的维度集合（写之前用来发现「上游换了维度」）。"""
    rows = await connection.fetch(_SELECT_EMBEDDING_DIMENSIONS, chunk_set_id, model)
    return {row["dimensions"] for row in rows}


async def save_embeddings(
    connection: Connection,
    *,
    chunk_set_id: UUID,
    model: str,
    dimensions: int,
    items: Sequence[tuple[int, Sequence[float]]],
) -> None:
    """按 `(chunk_set_id, ordinal, model)` upsert 一批向量，一个事务。"""
    if not items:
        return
    async with connection.transaction():
        await connection.executemany(
            _UPSERT_EMBEDDING,
            [(chunk_set_id, ordinal, model, dimensions, list(vector)) for ordinal, vector in items],
        )


async def save_index(connection: Connection, *, entry: IndexEntry) -> None:
    """把索引的当前版本写成 `entry`（旧版本被替换，不并存），一个事务。"""
    async with connection.transaction():
        await connection.execute(
            _UPSERT_INDEX,
            entry.tenant_id,
            entry.asset_id,
            entry.chunk_set_id,
            entry.model,
            entry.dimensions,
            entry.chunk_count,
            entry.collection,
        )
