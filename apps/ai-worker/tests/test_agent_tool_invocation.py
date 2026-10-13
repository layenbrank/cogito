"""直通通道（`POST /internal/v1/agents/tool-invocations`）的**行为**面。

这条路径是 MCP `tools/call` 的落地：cogito 的 MCP 端点在同步协议里要立刻拿到工具结果，
就把「执行一次不需要审批的工具」发到这里。与审批通道（`/agents/tool-executions`）是对称的
两条路：那条只收**需要审批**的工具，这条只收**不需要审批**的只读工具。这一组管的是这条路径的
**门槛与后果**：

* **准入只有三条**：工具认识、在白名单里、**没有**声明需要审批。三种不通过（不认识的名字、
  不在白名单、写工具）都是 400 `invalid_request`——那是「这次请求不该发过来」，
  不是「工具跑起来失败了」；**执行之后**才失败仍然是 `ok=false` 的 200；
* **写工具从这里进不来**：`memory_write` / `asset_visibility_write` 需要人工审批，而 MCP 是
  同步协议装不下审批这半程——直通通道放行它们就等于开了一个绕过审批的口子；
* **只读工具真的跑**：`knowledge_search` 在本进程自己的 pgvector 上做检索，不碰 cogito，
  结果是真实的命中文本而不是占位。

真库是必需的（检索要落在索引上，幂等账本也要写），所以这一组跟着 `database` 夹具走。
"""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient, Response

from ai_worker import errors
from ai_worker.agent_runtime.router import TOOL_INVOCATION_PATH
from support import (
    TENANT_ID,
    AgentStub,
    HandlerClient,
    internal_headers,
    seed_indexed_asset,
)

EMBED_MODEL = "text-embedding-3-small"
OBJECTIVE = "总结退款政策"
CHUNK_SET_ID = "3c9d5e7f-1a2b-4c3d-9e8f-7a6b5c4d3e2f"
TEXTS = ("退款政策是七天无理由退货。", "运费由买家承担。", "发票在订单详情页下载。")
QUERY = "退款政策"
QUERY_ARGUMENTS = f'{{"query":"{QUERY}"}}'

#: 幂等键有长度下限（8）。每个用例用不同后缀，避免跨用例串账本。
KEY = "invoke-key-0001"

NOTE_ARGUMENTS = '{"content":"运费由买家承担。"}'


def direct_call(
    *, name: str = "knowledge_search", arguments: str = QUERY_ARGUMENTS, call_id: str = "call-1"
) -> dict[str, Any]:
    """契约里的 `AgentToolCall`：扁平形状，`arguments` 是 JSON 字符串。"""
    return {"id": call_id, "name": name, "arguments": arguments}


def body(**overrides: Any) -> dict[str, Any]:
    """cogito 的 MCP `tools/call` 转来的直通请求（`AgentToolInvocationRequest`）。"""
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "tenantID": TENANT_ID,
        "embedModel": EMBED_MODEL,
        "allowedTools": ["knowledge_search"],
        "toolCall": direct_call(),
    }
    payload.update(overrides)
    return payload


async def invoke(
    client: AsyncClient, *, payload: dict[str, Any] | None = None, key: str = KEY
) -> Response:
    return await client.post(
        TOOL_INVOCATION_PATH,
        json=payload if payload is not None else body(),
        headers=internal_headers(idempotency_key=key),
    )


def tool_result(response: Response) -> dict[str, Any]:
    result: dict[str, Any] = response.json()["toolResult"]
    return result


def error_code(response: Response) -> str:
    return str(response.json()["error"]["code"])


# --------------------------------------------------------------------------- 只读工具真的跑


async def test_a_read_tool_runs_synchronously(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """直通通道上的只读工具真的执行：检索命中索引里的块，结果不是占位。"""
    await seed_indexed_asset(
        database,
        chunk_set_id=CHUNK_SET_ID,
        texts=TEXTS,
        model=EMBED_MODEL,
    )
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await invoke(client)

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is True
    assert result.get("awaitingApproval", False) is False
    # 查询文本与第一块一致，余弦距离为 0：命中的第一块必是它（见 support.seed_indexed_asset）。
    assert TEXTS[0] in result["content"]
    # 检索要对查询文本算向量：向量经 cogito 的嵌入端点（先换令牌、再算嵌入）。
    assert QUERY in "".join(stub.embedded_texts)


async def test_a_read_tool_failure_is_a_200_ok_false(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """工具跑起来失败了（参数不合法）仍是 200 + ok=false：这是给模型看的正常结果。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    # `topK` 超出 1–20 的上限，校验会拒绝。
    response = await invoke(
        client,
        payload=body(toolCall=direct_call(arguments='{"query":"退款","topK":999}')),
    )

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is False
    assert result.get("awaitingApproval", False) is False


# --------------------------------------------------------------------------- 准入


async def test_a_write_tool_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """写工具从直通通道进来一律 400：它需要人工审批，MCP 装不下审批这半程。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await invoke(
        client,
        payload=body(
            allowedTools=["memory_write"],
            toolCall=direct_call(name="memory_write", arguments=NOTE_ARGUMENTS),
        ),
    )

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value


async def test_a_tool_outside_the_allowlist_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """白名单外一律 400：直通通道不能绕开白名单（与 `steps` / `tool-executions` 同口径）。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await invoke(client, payload=body(allowedTools=["asset_read"]))

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value


async def test_an_unknown_tool_is_rejected(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """不认识的工具名一律 400：cogito 拼错要当场暴露，不能静默漏掉。"""
    stub = AgentStub()
    client = cogito_backed_client(stub)

    response = await invoke(
        client,
        payload=body(
            allowedTools=["shell"],
            toolCall=direct_call(name="shell", arguments="{}"),
        ),
    )

    assert response.status_code == 400
    assert error_code(response) == errors.ErrorCode.INVALID_REQUEST.value


async def test_replay_returns_the_same_result(
    cogito_backed_client: HandlerClient, database: Any
) -> None:
    """同一幂等键重投回放第一次的报文（直通通道同样有幂等账本）。"""
    await seed_indexed_asset(
        database,
        chunk_set_id=CHUNK_SET_ID,
        texts=TEXTS,
        model=EMBED_MODEL,
    )
    stub = AgentStub()
    client = cogito_backed_client(stub)

    first = await invoke(client)
    second = await invoke(client)

    assert first.status_code == 200
    assert second.status_code == 200
    assert tool_result(second) == tool_result(first)
