"""长期记忆：agent 把「此后还用得上的结论」写下来，之后的**其它任务**能按语义召回。

记忆与 RAG 检索的唯一区别是**数据是谁产生的**：RAG 的源在 cogito（资产正文），记忆的源在
agent 自己。所以写入路径与检索路径都必须自己成立，也就三件事：

1. **租户是硬边界**：`tenant_id` 进 `WHERE` 由库过滤（同 `rag_ingest/search.py`）。
   记忆是租户内的共享知识——同租户的另一个任务读得到，这正是「长期记忆」的意义；
   跨租户仍然什么都读不到。
2. **写入必须幂等**：两类记忆的 `memory_id` 都是**确定性**派生的——
   收尾摘要按 `uuid5(tenant, task)`，模型的笔记按 `uuid5(tenant, content)`——
   所以活动重试、实例续跑、甚至换一个进程接管，写的都是同一行
   （`INSERT ... ON CONFLICT (memory_id) DO NOTHING`）。这不是「顺手去重」，而是可靠执行的
   前提：活动是「至少执行一次」，做不到幂等就会写出 N 条一模一样的记忆，召回时白占上下文。
   同一条笔记被两个任务先后写下也只会留一行——同一句话就是这个事实，多一份副本没有价值。
3. **嵌入只有一条出口**：查询与正文都走 `providers.embeddings.embed_texts`（回打 cogito 的
   `scope=embeddings` 服务面），和 RAG 完全同一条路，不在 Python 侧另开算力出口。

`task_summary` 与 `note` 的区别只有出处：前者是 cogito 在任务收尾时写的（正文由本模块组装，
所以格式统一、可预期），后者是模型在任务中途自己写的（正文由模型给）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import NAMESPACE_URL, UUID, uuid5

from asyncpg import Connection
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from compute import errors, idempotency
from compute.agent_runtime.schemas import AgentMemoryRequest, AgentMemoryResponse
from compute.cogito_client import CogitoClient
from compute.db import Database, DatabaseUnavailableError
from compute.providers import embeddings

logger = logging.getLogger(__name__)

#: 收尾摘要的出处标签。
KIND_TASK_SUMMARY = "task_summary"
#: 模型自己写的记忆的出处标签。
KIND_NOTE = "note"
KINDS = (KIND_NOTE, KIND_TASK_SUMMARY)

#: 确定性 id 的命名空间：由一段固定 URL 派生，避免在代码里写一个来路不明的魔数 UUID。
#: 换掉它等于把「同一任务的摘要」判成另一条记忆，所以它是持久化契约的一部分。
_SUMMARY_NAMESPACE = uuid5(NAMESPACE_URL, "https://cogito.local/agent-memory/task-summary")
#: 笔记的命名空间：按正文去重（同一条笔记在同一个租户里只有一行）。
_NOTE_NAMESPACE = uuid5(NAMESPACE_URL, "https://cogito.local/agent-memory/note")

#: 拼 id 用的分隔符：租户与任务 id 都可能含 `:` 之类的字符，
#: 用 US（unit separator）保证 `("a:b","c")` 与 `("a","b:c")` 不会撞成同一个 id。
_SEPARATOR = "\x1f"

#: 单条记忆正文的字符上限。**只有一个数字**：工具的 `maxLength`、笔记与收尾摘要的裁剪
#: 都用它。做成常量而不是配置项，是因为它同时是「模型看到的说明书」的一部分——
#: 一个能改的说明书和一份实际执行的校验就又会分家（见 `tools` 的模块文档）。
MAX_CONTENT_CHARS = 2000

_SELECT_MEMORIES = """
SELECT memory_id,
       kind,
       content,
       task_id,
       created_at,
       embedding <=> $4 AS distance
  FROM agent_memory
 WHERE tenant_id = $1
   AND model = $2
   AND dimensions = $3
 ORDER BY distance, created_at DESC, memory_id
 LIMIT $5
"""

_SELECT_BY_ID = "SELECT memory_id, created_at FROM agent_memory WHERE memory_id = $1"

_INSERT = """
INSERT INTO agent_memory
       (memory_id, tenant_id, kind, content, task_id, model, dimensions, embedding)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (memory_id) DO NOTHING
RETURNING memory_id
"""


@dataclass(frozen=True, slots=True)
class Memory:
    """一条被召回的记录。`score` 是余弦相似度（`1 - 距离`），越大越相近。"""

    memory_id: UUID
    kind: str
    content: str
    task_id: str | None
    score: float
    created_at: datetime


@dataclass(frozen=True, slots=True)
class Written:
    """一次写入的结果。`created=False` 表示这条记忆**已经存在**（幂等命中，不是失败）。"""

    memory_id: UUID
    created: bool


def summary_id(*, tenant_id: str, task_id: str) -> UUID:
    """收尾摘要的确定性 id：同一个任务永远得到同一个 id。"""
    return uuid5(_SUMMARY_NAMESPACE, f"{tenant_id}{_SEPARATOR}{task_id}")


def note_id(*, tenant_id: str, content: str) -> UUID:
    """笔记的确定性 id：同一个租户下正文相同的笔记只占一行。"""
    return uuid5(_NOTE_NAMESPACE, f"{tenant_id}{_SEPARATOR}{content}")


async def recall(
    connection: Connection,
    cogito: CogitoClient,
    *,
    tenant_id: str,
    model: str,
    query: str,
    top_k: int,
    batch_size: int,
) -> list[Memory]:
    """把 `query` 嵌成向量，再在**本租户**的记忆里取最相近的 `top_k` 条。

    `dimensions` 从查询向量自己的长度取（同检索面）：它进 `WHERE` 是为了挡掉「同一个模型、
    两种维度」的历史数据——那种数据会让 `<=>` 直接报维度不匹配。
    """
    batch = await embeddings.embed_texts(
        cogito, tenant_id=tenant_id, model=model, texts=[query], batch_size=batch_size
    )
    if not batch.vectors:  # pragma: no cover - 空输入在上面就被调用方拦住了
        return []

    rows = await connection.fetch(
        _SELECT_MEMORIES,
        tenant_id,
        model,
        batch.dimensions,
        list(batch.vectors[0]),
        top_k,
    )
    return [
        Memory(
            memory_id=row["memory_id"],
            kind=row["kind"],
            content=row["content"],
            task_id=row["task_id"],
            score=1.0 - float(row["distance"]),
            created_at=row["created_at"],
        )
        for row in rows
    ]


async def write(
    connection: Connection,
    cogito: CogitoClient,
    *,
    tenant_id: str,
    model: str,
    content: str,
    kind: str,
    task_id: str | None,
    batch_size: int,
) -> Written:
    """写一条记忆。同一个 `memory_id` 已经存在时**什么都不写**并回报 `created=False`。

    先查一次主键再嵌入，是为了让「重放」这条常见路径（活动重试、台账回放）**不花一次
    嵌入算力**；并发下两个请求同时走到插入时由 `ON CONFLICT DO NOTHING` 兜底。
    """
    if kind not in KINDS:  # pragma: no cover - 两个调用点的 kind 都是常量
        message = f"未知的记忆类型 {kind!r}"
        raise ValueError(message)

    text = content.strip()
    if not text:
        raise errors.invalid_request("记忆正文不能只有空白字符")

    if kind == KIND_TASK_SUMMARY:
        if not task_id:  # pragma: no cover - 表上的 CHECK 与这里守卫同一件事
            message = "任务结论必须带 taskID：没有它既无法幂等，也无从追溯"
            raise errors.invalid_request(message)
        memory_id = summary_id(tenant_id=tenant_id, task_id=task_id)
    else:
        memory_id = note_id(tenant_id=tenant_id, content=text)

    existing = await connection.fetchval(_SELECT_BY_ID, memory_id)
    if existing is not None:
        logger.info("记忆 %s 已存在，跳过写入（幂等命中）", memory_id)
        return Written(memory_id=memory_id, created=False)

    batch = await embeddings.embed_texts(
        cogito, tenant_id=tenant_id, model=model, texts=[text], batch_size=batch_size
    )
    if not batch.vectors:  # pragma: no cover - 空正文在上面就被拦住了
        message = "空文本无法嵌入"
        raise ValueError(message)

    inserted = await connection.fetchval(
        _INSERT,
        memory_id,
        tenant_id,
        kind,
        text,
        task_id,
        model,
        batch.dimensions,
        list(batch.vectors[0]),
    )
    return Written(memory_id=memory_id, created=inserted is not None)


def summarise(
    *,
    objective: str,
    answer: str,
    steps: int,
    tool_calls: int,
    max_chars: int,
) -> str:
    """把一次任务收尾的结论组装成一段可召回的正文（**服务端组装**，不由模型自由发挥）。

    格式统一才可能被之后的模型读懂：先「任务」再「结论」，最后一行是规模（步数 / 工具调用数），
    让读到的模型能判断这条记忆有多"重"。答案过长时**从尾部截断**：结论的开头通常是要点。
    """
    body = (
        f"任务：{objective.strip()}\n"
        f"结论：{answer.strip()}\n"
        f"（该任务用了 {steps} 步、{tool_calls} 次工具调用）"
    )
    if len(body) <= max_chars:
        return body
    notice = f"…（结论被截断，共 {len(body)} 字符）"
    keep = max(max_chars - len(notice), 0)
    return body[:keep] + notice


MEMORY_PATH = "/internal/v1/agents/memories"
#: 幂等账本里的端点名。**不要**跟着路径改：它是历史账本的键，改了等于把已完成的调用作废。
ENDPOINT = "agents.memories"

ROUTER = APIRouter()


@ROUTER.post(MEMORY_PATH, summary="记下一条任务结论（长期记忆）")
async def remember(request: Request, body: AgentMemoryRequest) -> JSONResponse:
    """把一个已收尾任务的结论写进长期记忆。

    响应码：200 成功（`created=false` 表示这条记忆早就在库里）；400 正文为空或参数不合法；
    401 内部令牌不对；409 幂等键冲突或仍在执行中；429 cogito 限流；503 数据库或 cogito 暂时不可用。
    """
    # 空白正文拼出来的摘要等于「任务：xxx / 结论：」，召回时只会污染上下文，当场拒掉。
    if not body.answer.strip():
        message = "answer 不能只有空白字符：空白结论不该进长期记忆"
        raise errors.invalid_request(message)

    payload = {
        "tenantID": body.tenant_id,
        "taskID": body.task_id,
        "objective": body.objective,
        "answer": body.answer,
        "steps": body.steps,
        "toolCalls": body.tool_calls,
        "embedModel": body.embed_model,
    }

    async with idempotency.guarded(request, endpoint=ENDPOINT, payload=payload) as run:
        replayed = idempotency.replay_response(run)
        if replayed is not None:
            logger.info("幂等重发，回放任务 %s 的记忆结果", body.task_id)
            return replayed

        response = await _remember(request, body=body)
        run.record(status=200, body=response.wire())
        return JSONResponse(response.wire())


async def _remember(request: Request, *, body: AgentMemoryRequest) -> AgentMemoryResponse:
    settings = request.app.state.settings
    cogito: CogitoClient = request.app.state.cogito
    database: Database = request.app.state.db

    content = summarise(
        objective=body.objective,
        answer=body.answer,
        steps=body.steps,
        tool_calls=body.tool_calls,
        max_chars=MAX_CONTENT_CHARS,
    )

    try:
        async with database.acquire() as connection:
            written = await write(
                connection,
                cogito,
                tenant_id=body.tenant_id,
                model=body.embed_model,
                content=content,
                kind=KIND_TASK_SUMMARY,
                task_id=body.task_id,
                batch_size=settings.embed_batch_size,
            )
    except DatabaseUnavailableError as exc:
        raise errors.dependency_unavailable(str(exc)) from exc

    logger.info(
        "任务 %s 的结论已记入长期记忆（memoryID=%s, created=%s）",
        body.task_id,
        written.memory_id,
        written.created,
    )
    return AgentMemoryResponse.from_parts(memory_id=written.memory_id, created=written.created)
