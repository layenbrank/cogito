"""审批通道（`POST /internal/v1/agents/tool-executions`）的**行为**面。

P10a 把「写」拆成了两拍：`/agents/steps` 遇到声明了 `requires_approval` 的工具只回一条
`awaitingApproval=true` 的占位结果（不执行、不落库），人工批准之后 cogito 再从这条路径把那次
调用真的跑掉。这一组管的是这条路径的**门槛与后果**：

* **准入只有两条**：工具自己声明了需要审批、且在 `allowedTools` 里。三种不通过（不认识的名字、
  不在白名单、不需要审批）都是 400 `invalid_request`——那是「这次请求不该发过来」，
  不是「工具跑起来失败了」；**执行之后**才失败仍然是 `ok=false` 的 200；
* **不校验审批本身**：台账在 cogito，信任边界是内部令牌加上面两条规则。所以这里也**不假装**
  校验过批准——没有任何断言能证明「它被批准过」；
* **写入的后果是真的**：落一行笔记（`task_id` 为空），并且照样受校验与写预算约束；
* **重投收敛**：同一个键回放第一次的报文，换个键也不会写出第二行（`memory_id` 是确定性派生的）。

真库是必需的（幂等账本与记忆都要落库），所以这一组跟着 `database` 夹具走。
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient, Response

from compute import errors
from compute.agent_runtime import memory, tools
from compute.agent_runtime.router import STEP_PATH, TOOL_EXECUTION_PATH
from support import (
    TENANT_ID,
    AgentStub,
    HandlerClient,
    RagStub,
    completion,
    internal_headers,
    tool_call,
    traceparent_only,
)

EMBED_MODEL = "text-embedding-3-small"
CHAT_MODEL = "stub-chat-model"
OBJECTIVE = "总结退款政策"
TASK_ID = "0d3f1f7c-1b2a-4c5d-8e9f-0a1b2c3d4e5f"
APPROVAL_ID = "0f5b0a2c-91f3-4e77-9a1e-2b3c4d5e6f70"

#: 幂等键有长度下限（8）。每个用例用不同后缀，避免跨用例串账本。
KEY = "approval-key-0001"

NOTE = "运费由买家承担。"
NOTE_ARGUMENTS = f'{{"content":"{NOTE}"}}'


def pending_call(
    arguments: str = NOTE_ARGUMENTS, *, name: str = "memory_write", call_id: str = "call-1"
) -> dict[str, Any]:
    """契约里的 `AgentToolCall`：**扁平**形状，`arguments` 是 JSON 字符串。"""
    return {"id": call_id, "name": name, "arguments": arguments}


def body(**overrides: Any) -> dict[str, Any]:
    """cogito 在人工批准后发来的执行请求（`AgentToolExecutionRequest`）。"""
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": TENANT_ID,
        "taskID": TASK_ID,
        "approvalID": APPROVAL_ID,
        "embedModel": EMBED_MODEL,
        "allowedTools": ["memory_write"],
        "toolCall": pending_call(),
    }
    payload.update(overrides)
    return payload


async def execute(
    client: AsyncClient, *, payload: dict[str, Any] | None = None, key: str = KEY
) -> Response:
    return await client.post(
        TOOL_EXECUTION_PATH,
        json=payload if payload is not None else body(),
        headers=internal_headers(idempotency_key=key),
    )


async def step(
    client: AsyncClient, *, allowed: list[str] | None = None, key: str = KEY
) -> Response:
    """先走一遍单步端点：用来对照「占位」与「真执行」两半的区别。"""
    return await client.post(
        STEP_PATH,
        json={
            "schemaVersion": 1,
            "tenantID": TENANT_ID,
            "objective": OBJECTIVE,
            "model": CHAT_MODEL,
            "embedModel": EMBED_MODEL,
            "allowedTools": allowed if allowed is not None else ["memory_write"],
            "remainingSteps": 3,
        },
        headers=internal_headers(idempotency_key=f"step-{key}"),
    )


async def stored_notes(database: Any) -> list[dict[str, Any]]:
    """直接读库：工具的返回值只说它自己以为做了什么，正文与 `task_id` 只能从这里核对。"""
    async with database.acquire() as connection:
        rows = await connection.fetch(
            "SELECT kind, content, task_id FROM agent_memory ORDER BY created_at, memory_id"
        )
    return [dict(row) for row in rows]


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


def tool_result(response: Response) -> dict[str, Any]:
    result: dict[str, Any] = response.json()["toolResult"]
    return result


# --------------------------------------------------------------------------- 两半的对照


async def test_a_gated_call_only_really_runs_after_approval(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """单步里只留占位；批过之后同一份调用真的写进去。这是 P10a 的全部意义。"""
    stub = AgentStub(
        replies=[completion(tool_calls=[tool_call(name="memory_write", arguments=NOTE_ARGUMENTS)])]
    )
    client = cogito_backed_client(stub)

    pending = await step(client)

    placeholder = pending.json()["toolResults"][0]
    assert placeholder["ok"] is False
    assert placeholder["awaitingApproval"] is True
    assert placeholder["error"] == tools.AWAITING_APPROVAL_ERROR
    # 占位是真的没执行：库里一行没有，连嵌入都还没花。
    assert await stored_notes(database) == []
    assert stub.embed_calls == 0

    approved = await execute(client)

    assert approved.status_code == 200
    result = tool_result(approved)
    assert result["ok"] is True
    assert result.get("awaitingApproval", False) is False
    assert await stored_notes(database) == [
        {"kind": memory.KIND_NOTE, "content": NOTE, "task_id": None}
    ]
    assert stub.embed_calls == 1


async def test_the_approved_write_is_a_note_later_tasks_can_recall(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """落库的是**笔记**（`task_id` 为空，不是任务摘要），并明说本步读不到它。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await execute(client)

    result = tool_result(response)
    assert "之后的其它任务" in result["content"]
    assert NOTE in result["content"]
    assert await stored_notes(database) == [
        {"kind": memory.KIND_NOTE, "content": NOTE, "task_id": None}
    ]


async def test_the_execution_does_not_call_the_model(
    cogito_backed_client: HandlerClient,
) -> None:
    """执行一次已经想清楚了的调用：不需要再问模型一遍（那样会把成本翻倍）。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    await execute(client)

    assert stub.chat_calls == 0


# --------------------------------------------------------------------------- 准入


async def test_a_tool_that_does_not_need_approval_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """只读工具走普通工具调用：拿这条路径跑它等于开了一个绕过白名单的口子。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await execute(
        client,
        payload=body(
            allowedTools=["knowledge_search"],
            toolCall=pending_call('{"query":"退款"}', name="knowledge_search"),
        ),
    )

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value
    assert "不需要人工审批" in response.json()["error"]["message"]
    # 400 是「请求不该发过来」：没跑工具，也没占住幂等键（见下一条）。
    assert stub.paths == []


async def test_a_gated_tool_outside_the_allowlist_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """审批不能绕开白名单：`allowedTools` 是 cogito 的策略，不是可以事后补的手续。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await execute(client, payload=body(allowedTools=["knowledge_search"]))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value
    assert "allowedTools" in response.json()["error"]["message"]
    assert await stored_notes(database) == []


async def test_an_unknown_tool_name_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """不认识的名字要当场说清可用清单：静默放行只会让模型以为「批了但没效果」。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await execute(
        client,
        payload=body(allowedTools=["shell_exec"], toolCall=pending_call("{}", name="shell_exec")),
    )

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value
    assert "memory_write" in response.json()["error"]["message"]
    assert await stored_notes(database) == []


async def test_a_rejected_request_does_not_consume_the_idempotency_key(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """准入在账本**之前**：cogito 用同一个键改对参数重发，不能被判成 409。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    rejected = await execute(client, payload=body(allowedTools=["knowledge_search"]))
    accepted = await execute(client)

    assert rejected.status_code == 400
    assert accepted.status_code == 200
    assert tool_result(accepted)["ok"] is True


# --------------------------------------------------------------------------- 重投收敛


async def test_a_repeated_delivery_converges_on_the_first_result(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """同一个键重复投递：回放第一次的报文，不再写一次、也不再花一次嵌入算力。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    first = await execute(client)
    replay = await execute(client)

    assert replay.status_code == 200
    assert replay.json() == first.json()
    assert len(await stored_notes(database)) == 1
    assert stub.embed_calls == 1


async def test_a_new_key_does_not_write_the_note_twice(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """换一个键（活动重试 / 换进程接管）：`memory_id` 是确定性派生的，所以只有一行。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    first = await execute(client)
    again = await execute(client, key="approval-key-0002")

    assert tool_result(first)["ok"] is True
    repeated = tool_result(again)
    assert repeated["ok"] is True
    assert "此前已经记过" in repeated["content"]
    assert len(await stored_notes(database)) == 1
    # 命中主键就不再花一次嵌入：重放是常见路径，不该按首次写入计价。
    assert stub.embed_calls == 1


async def test_the_same_key_with_a_different_payload_is_a_conflict(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """同一个键换了载荷 = 调用方在复用别人的键，必须 409（否则会静默回放错的结果）。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)
    await execute(client)

    response = await execute(
        client,
        payload=body(toolCall=pending_call('{"content":"发票在订单详情页下载。"}')),
    )

    assert response.status_code == 409
    assert error_code(response) == errors.ErrorCode.IDEMPOTENCY_CONFLICT.value


async def test_the_allowlist_order_does_not_change_the_key(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """`allowedTools` 是**集合**语义：换个顺序重发不该变成另一次写入。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    first = await execute(client, payload=body(allowedTools=["memory_write", "knowledge_search"]))
    replay = await execute(client, payload=body(allowedTools=["knowledge_search", "memory_write"]))

    assert replay.json() == first.json()
    assert len(await stored_notes(database)) == 1


# --------------------------------------------------------------------------- 执行之后才失败


async def test_an_execution_failure_stays_a_two_hundred_with_ok_false(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """写预算用尽：工具**跑起来了**才失败，所以是 200 + `ok=false`，不是 4xx。"""
    stub = AgentStub()
    client = cogito_backed_client(stub, agent_memory_max_writes_per_step=0)

    response = await execute(client)

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is False
    assert result.get("awaitingApproval", False) is False
    assert "已用尽" in result["content"]
    assert await stored_notes(database) == []


async def test_a_blank_note_is_refused_without_writing(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """`minLength: 1` 拦不住一个空格：执行前的去空白校验仍要拦在写库之前。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await execute(client, payload=body(toolCall=pending_call('{"content":"   "}')))

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is False
    assert "空白" in result["content"]
    assert await stored_notes(database) == []


async def test_an_over_long_note_is_refused_by_the_shared_schema(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """说明书与执行共用同一份声明：模型看到的 `maxLength` 就是执行时校验的那个。"""
    declared = tools.catalog(["memory_write"])[0]["function"]["parameters"]["properties"]["content"]
    assert declared["maxLength"] == memory.MAX_CONTENT_CHARS

    stub = AgentStub()
    client = cogito_backed_client(stub)
    too_long = "长" * (memory.MAX_CONTENT_CHARS + 1)

    response = await execute(
        client, payload=body(toolCall=pending_call('{"content":"' + too_long + '"}'))
    )

    result = tool_result(response)
    assert result["ok"] is False
    assert f"最多 {memory.MAX_CONTENT_CHARS} 个字符" in result["content"]
    assert await stored_notes(database) == []


async def test_a_broken_upstream_is_retryable_and_writes_nothing(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """嵌入响应畸形：宁可整体 503 让 cogito 重试，也不要把半条记忆写进库。

    这一条也钉住「暂时性故障向上抛」与「工具失败回 `ok=false`」的分界。
    """
    stub = RagStub(embedding_response=lambda inputs, call: {"data": []})
    client = cogito_backed_client(stub)

    response = await execute(client)

    assert response.status_code == 503
    assert error_code(response) == errors.ErrorCode.DEPENDENCY_UNAVAILABLE.value
    assert await stored_notes(database) == []
    assert stub.embed_calls == 1


# --------------------------------------------------------------------------- 鉴别


@pytest.mark.parametrize("label", ["missing", "wrong"])
async def test_a_bad_internal_token_is_unauthorized(
    cogito_backed_client: HandlerClient, database: Any, label: str
) -> None:
    """审批通道是**更高价值**的入口（它能真的写东西），令牌这一层不能比别处松。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)
    headers = traceparent_only() if label == "missing" else internal_headers(token="not-the-token")

    response = await client.post(TOOL_EXECUTION_PATH, json=body(), headers=headers)

    assert response.status_code == 401
    assert error_code(response) == errors.ErrorCode.UNAUTHORIZED.value
    # 401 发生在任何业务之前：没跑工具（连 cogito 都没碰），也没有落库。
    assert stub.paths == []
    assert await stored_notes(database) == []
