"""长期记忆（`POST /internal/v1/agents/memories`）的**行为**面。

形状与状态码的合规由 `test_contract_conformance.py` 管，这里管的是「记下来的到底是什么、
以及它在什么情况下会变味」：

* **摘要由服务端组装**：cogito 只给零件（目标 / 结论 / 规模），格式统一了才可能被之后的模型读懂；
* **写入幂等**：`memory_id` 由 `(租户, 任务)` 确定性派生，所以活动重试、实例续跑、换进程接管
  写的都是同一行——「至少执行一次」的活动做不到幂等，召回时就会白占上下文；
* **空白结论当场拒掉**：拼出来等于「任务：xxx / 结论：」的正文只会污染之后的召回；
* **召回边界是租户 + 模型**：同租户的另一个任务读得到（长期记忆的意义所在），别的租户读不到。

真库是必需的（记忆要落 pgvector），所以这一组跟着 `database` 夹具走。
"""

from __future__ import annotations

from typing import Any
from uuid import NAMESPACE_URL, uuid5

from httpx import AsyncClient, Response

from compute import errors
from compute.agent_runtime import memory
from compute.cogito_client import CogitoClient
from compute.db import Database
from support import (
    TENANT_ID,
    AgentStub,
    HandlerClient,
    MakeCogito,
    internal_headers,
)

#: 冻结的命名空间：与 `memory.py` 里的实现**故意分开写一份**——它们是被持久化的键的一部分，
#: 改了就等于把已经写进库的那批记忆判成另一批（同一个任务会再写一行）。
_SUMMARY_NAMESPACE = uuid5(NAMESPACE_URL, "https://cogito.local/agent-memory/task-summary")
_NOTE_NAMESPACE = uuid5(NAMESPACE_URL, "https://cogito.local/agent-memory/note")

EMBED_MODEL = "text-embedding-3-small"
OTHER_TENANT = "tenant-b"
TASK_ID = "0d3f1f7c-1b2a-4c5d-8e9f-0a1b2c3d4e5f"
OBJECTIVE = "总结退款政策"
ANSWER = "七天无理由退货，运费由买家承担。"

#: 幂等键有长度下限（8）。每个用例用不同后缀，避免跨用例串账本。
KEY = "memory-key-0001"


def body(**overrides: Any) -> dict[str, Any]:
    """cogito 会发来的最小记忆请求：一个已收尾任务的零件。"""
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": TENANT_ID,
        "taskID": TASK_ID,
        "objective": OBJECTIVE,
        "answer": ANSWER,
        "steps": 2,
        "toolCalls": 1,
        "embedModel": EMBED_MODEL,
    }
    payload.update(overrides)
    return payload


async def remember(
    client: AsyncClient, *, payload: dict[str, Any] | None = None, key: str = KEY
) -> Response:
    return await client.post(
        memory.MEMORY_PATH,
        json=payload if payload is not None else body(),
        headers=internal_headers(idempotency_key=key),
    )


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


async def stored_rows(database: Database) -> list[dict[str, Any]]:
    """直接读库：端点回的是 id 与 `created`，正文与派生规则只能从这里核对。"""
    async with database.acquire() as connection:
        rows = await connection.fetch(
            "SELECT memory_id, tenant_id, kind, content, task_id, model, dimensions"
            "  FROM agent_memory ORDER BY created_at, memory_id"
        )
    return [dict(row) for row in rows]


def expected_summary(**overrides: Any) -> str:
    parts: dict[str, Any] = {"objective": OBJECTIVE, "answer": ANSWER, "steps": 2, "tool_calls": 1}
    parts.update(overrides)
    return memory.summarise(max_chars=memory.MAX_CONTENT_CHARS, **parts)


# --------------------------------------------------------------------------- 写入


async def test_a_conclusion_is_summarised_embedded_and_stored(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """一次成功写入：正文由服务端拼好、拿去嵌入、连向量一起落库。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await remember(client)

    assert response.status_code == 200
    memory_id = memory.summary_id(tenant_id=TENANT_ID, task_id=TASK_ID)
    assert response.json() == {
        "schemaVersion": 1,
        "memoryID": str(memory_id),
        "created": True,
    }

    summary = expected_summary()
    # 嵌入的必须**就是**落库的那段正文：两者一旦分家，召回匹配的是另一段文本。
    assert stub.embedded_texts == [summary]
    assert summary.startswith(f"任务：{OBJECTIVE}")
    assert f"结论：{ANSWER}" in summary
    assert "用了 2 步、1 次工具调用" in summary

    rows = await stored_rows(database)
    assert len(rows) == 1
    row = rows[0]
    assert row["memory_id"] == memory_id
    assert row["tenant_id"] == TENANT_ID
    assert row["kind"] == memory.KIND_TASK_SUMMARY
    assert row["content"] == summary
    assert row["task_id"] == TASK_ID
    assert row["model"] == EMBED_MODEL
    assert row["dimensions"] == 8


async def test_replaying_a_task_with_a_new_key_does_not_write_twice(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """换一个幂等键重投同一个任务（活动重试 / 换进程接管）：同一行，且不重复花嵌入算力。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)
    memory_id = memory.summary_id(tenant_id=TENANT_ID, task_id=TASK_ID)

    first = await remember(client, key=KEY)
    again = await remember(client, key="memory-key-0002")

    assert first.json()["created"] is True
    assert again.status_code == 200
    assert again.json() == {
        "schemaVersion": 1,
        "memoryID": str(memory_id),
        "created": False,
    }
    # 先查主键再嵌入：重放这条常见路径不该再调一次上游。
    assert stub.embed_calls == 1
    assert len(await stored_rows(database)) == 1


async def test_the_same_key_replays_the_recorded_response(
    cogito_backed_client: HandlerClient,
) -> None:
    """同一个键重复投递：回放第一次的响应，不重新嵌入（更不会写出第二行）。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    first = await remember(client)
    replay = await remember(client)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert stub.embed_calls == 1


async def test_a_blank_answer_never_reaches_the_database(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """空白结论拼出来等于「任务：xxx / 结论：」：当场拒掉，别让它污染之后的召回。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await remember(client, payload=body(answer="   \n "))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value
    assert stub.embed_calls == 0
    assert await stored_rows(database) == []


async def test_a_long_conclusion_is_cut_from_the_tail(
    cogito_backed_client: HandlerClient, database: Database
) -> None:
    """超长结论从尾部截断并附上原始长度：结论的开头通常是要点，而模型要知道自己没看全。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)
    long_answer = "退款说明。" * 400

    response = await remember(client, payload=body(answer=long_answer))

    assert response.status_code == 200
    full = memory.summarise(
        objective=OBJECTIVE,
        answer=long_answer,
        steps=2,
        tool_calls=1,
        max_chars=len(long_answer) * 2,  # 上限给足 ⇒ 拿到未截断的正文，用来算「原始长度」
    )
    assert len(full) > memory.MAX_CONTENT_CHARS

    content = (await stored_rows(database))[0]["content"]
    assert content.startswith(f"任务：{OBJECTIVE}")  # 头部（要点）留下
    assert content.endswith(f"共 {len(full)} 字符）")  # 尾部换成截断说明，总数是**原始**正文长度
    assert len(content) <= memory.MAX_CONTENT_CHARS
    assert stub.embedded_texts == [content]


async def test_a_broken_database_is_reported_as_retryable(offline_client: AsyncClient) -> None:
    """库连不上是暂时性故障（503）：cogito 会重试，而重试写的是同一行（id 是确定性派生的）。"""
    response = await offline_client.post(
        memory.MEMORY_PATH, json=body(), headers=internal_headers(idempotency_key=KEY)
    )

    assert response.status_code == 503
    assert error_code(response) == errors.ErrorCode.DEPENDENCY_UNAVAILABLE.value


# --------------------------------------------------------------------------- 召回边界


async def test_recall_is_bounded_by_tenant_and_model(
    cogito_backed_client: HandlerClient, make_cogito: MakeCogito, database: Database
) -> None:
    """同租户读得到，别的租户读不到；模型也是边界（同一模型的两种维度会让 `<=>` 报错）。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)
    await remember(client)

    cogito: CogitoClient = make_cogito(stub)
    async with database.acquire() as connection:
        mine = await memory.recall(
            connection,
            cogito,
            tenant_id=TENANT_ID,
            model=EMBED_MODEL,
            query=OBJECTIVE,
            top_k=5,
            batch_size=8,
        )
        foreign = await memory.recall(
            connection,
            cogito,
            tenant_id=OTHER_TENANT,
            model=EMBED_MODEL,
            query=OBJECTIVE,
            top_k=5,
            batch_size=8,
        )
        other_model = await memory.recall(
            connection,
            cogito,
            tenant_id=TENANT_ID,
            model="another-embedding-model",
            query=OBJECTIVE,
            top_k=5,
            batch_size=8,
        )

    assert [item.memory_id for item in mine] == [
        memory.summary_id(tenant_id=TENANT_ID, task_id=TASK_ID)
    ]
    assert mine[0].kind == memory.KIND_TASK_SUMMARY
    assert mine[0].task_id == TASK_ID
    assert ANSWER in mine[0].content
    # 查询文本与记忆正文不同，所以相似度必然小于 1，但只有这一条时它仍是第一条。
    assert mine[0].score < 1.0
    assert foreign == []
    assert other_model == []


# --------------------------------------------------------------------------- id 的派生规则


def test_ids_are_deterministic_and_not_confused_by_separators() -> None:
    """id 是持久化契约的一部分：同一个任务永远同一个 id，且拼串不会把两个任务粘成一个。"""
    first = memory.summary_id(tenant_id=TENANT_ID, task_id=TASK_ID)
    assert first == memory.summary_id(tenant_id=TENANT_ID, task_id=TASK_ID)
    assert first != memory.summary_id(tenant_id=TENANT_ID, task_id="another-task")
    assert first != memory.summary_id(tenant_id=OTHER_TENANT, task_id=TASK_ID)

    # 分隔符必须是「内容里不可能出现的字符」：若用 `:`，下面两组会拼成同一个字符串。
    assert memory.summary_id(tenant_id="a:b", task_id="c") != memory.summary_id(
        tenant_id="a", task_id="b:c"
    )

    note = memory.note_id(tenant_id=TENANT_ID, content="运费由买家承担。")
    assert note == memory.note_id(tenant_id=TENANT_ID, content="运费由买家承担。")
    assert note != memory.note_id(tenant_id=OTHER_TENANT, content="运费由买家承担。")
    assert note != memory.note_id(tenant_id=TENANT_ID, content="运费由卖家承担。")


def test_summarise_trims_the_parts_and_announces_the_cut() -> None:
    """零件前后空白先去掉（否则摘要里会出现空行），超长时明说自己被截断。"""
    assert (
        memory.summarise(
            objective="  总结退款政策  ",
            answer="  七天无理由。  ",
            steps=1,
            tool_calls=0,
            max_chars=memory.MAX_CONTENT_CHARS,
        )
        == "任务：总结退款政策\n结论：七天无理由。\n（该任务用了 1 步、0 次工具调用）"
    )

    cut = memory.summarise(
        objective=OBJECTIVE, answer="结论。" * 100, steps=1, tool_calls=0, max_chars=40
    )
    assert len(cut) == 40
    assert cut.endswith("字符）")


def test_ids_are_derived_from_a_frozen_namespace_and_separator() -> None:
    """id 是已落库数据的键：命名空间或分隔符一改，同一任务就会被判成另一条记忆（写重一行）。"""
    assert memory.summary_id(tenant_id="tenant-a", task_id="task-1") == uuid5(
        _SUMMARY_NAMESPACE, "tenant-a\x1ftask-1"
    )
    assert memory.note_id(tenant_id="tenant-a", content="运费由买家承担。") == uuid5(
        _NOTE_NAMESPACE, "tenant-a\x1f运费由买家承担。"
    )
