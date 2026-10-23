"""按审批改可见性（`asset_visibility_write`）：单步只占位，批准之后才真的写。

P10b 把「写」从本进程的一行数据扩到了 cogito 侧的落地动作。这一组盯的是它比 `memory_write`
更严的那几条不变量：

* **两半的对照**：`/agents/steps` 里不换令牌、不碰写端点，只回一条占位结果；
* **凭据即能力**：批准之后才用 `approvalID` 换一枚 `scope=asset-write` 的写令牌，
  写请求**没有 body**——改什么在换令牌那一步就由 cogito 从台账读出来钉死了；
* **描述用落地值**：真正写下去的是批准时那一份，所以结果只能照 cogito 回报的
  `visibility` / `viewers` 说话，不能照模型请求的那一份；
* **一次审批一份令牌**：写令牌按 `approvalID` 分开缓存，两次不同的审批不会互相顶替；
* **拒绝是终局**：`403 + 500509`（审批不合规）变成 `ok=false` 的 200，而不是让 cogito
  反复重试整步的 503；但 `401`（我们自己令牌配错）仍然必须是 503。

真库是必需的（幂等账本要落库），所以这一组跟着 `cogito_backed_client` 夹具走。
"""

from __future__ import annotations

from itertools import count
from typing import Any

import pytest
from httpx import AsyncClient, Response

from compute import errors
from compute.agent_runtime import tools
from compute.agent_runtime.router import STEP_PATH, TOOL_EXECUTION_PATH
from compute.agent_runtime.schemas import AgentToolCall
from compute.cogito_client import (
    APPROVAL_INVALID_CODE,
    ASSET_VISIBILITY_PATH,
    SCOPE_ASSET_WRITE,
    SCOPE_CHAT,
    SERVICE_TOKEN_HEADER,
)
from compute.db import Database
from support import (
    ASSET_ID,
    TENANT_ID,
    AgentStub,
    HandlerClient,
    MakeCogito,
    completion,
    internal_headers,
    make_settings,
    tool_call,
)

EMBED_MODEL = "text-embedding-3-small"
CHAT_MODEL = "stub-chat-model"
OBJECTIVE = "把这个资产设成公开"
TASK_ID = "0d3f1f7c-1b2a-4c5d-8e9f-0a1b2c3d4e5f"
APPROVAL_ID = "0f5b0a2c-91f3-4e77-9a1e-2b3c4d5e6f70"
OTHER_APPROVAL_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d"
VIEWERS = ("2b0b1c1e-6d5a-4f7b-8c9d-0e1f2a3b4c5d", "3c1c2d2f-7e6b-4a8c-9d0e-1f2a3b4c5d6e")

TOOL = "asset_visibility_write"
PUBLIC_ARGUMENTS = f'{{"assetID":"{ASSET_ID}","visibility":"PUBLIC"}}'

#: 幂等键有长度下限（8）。默认按调用序号生成，避免用例之间串账本；要验证「同一份请求重投」
#: 的用例自己显式传同一个键。
_KEYS = count(1)


def execution_body(
    arguments: str = PUBLIC_ARGUMENTS, *, approval_id: str = APPROVAL_ID
) -> dict[str, Any]:
    """cogito 在人工批准之后发来的执行请求（`AgentToolExecutionRequest`）。"""
    return {
        "schemaVersion": 1,
        "tenantID": TENANT_ID,
        "taskID": TASK_ID,
        "approvalID": approval_id,
        "embedModel": EMBED_MODEL,
        "allowedTools": [TOOL],
        "toolCall": {"id": "call-1", "name": TOOL, "arguments": arguments},
    }


async def execute(
    client: AsyncClient,
    *,
    arguments: str = PUBLIC_ARGUMENTS,
    approval_id: str = APPROVAL_ID,
    key: str | None = None,
) -> Response:
    return await client.post(
        TOOL_EXECUTION_PATH,
        json=execution_body(arguments, approval_id=approval_id),
        headers=internal_headers(idempotency_key=key or f"execution-key-{next(_KEYS):04d}"),
    )


async def step(client: AsyncClient, *, key: str | None = None) -> Response:
    """走一遍单步端点：用来对照「占位」与「真执行」两半的区别。"""
    return await client.post(
        STEP_PATH,
        json={
            "schemaVersion": 1,
            "tenantID": TENANT_ID,
            "objective": OBJECTIVE,
            "model": CHAT_MODEL,
            "embedModel": EMBED_MODEL,
            "allowedTools": [TOOL],
            "remainingSteps": 3,
        },
        headers=internal_headers(idempotency_key=key or f"step-key-{next(_KEYS):04d}"),
    )


def stub_with_landing_value(*viewers: str) -> AgentStub:
    """一个「批准的是 RESTRICTED + 名单」的 cogito 桩，与模型请求的 PUBLIC 故意不同。"""
    return AgentStub(
        replies=[completion(tool_calls=[tool_call(name=TOOL, arguments=PUBLIC_ARGUMENTS)])],
        visibility_response={"visibility": "RESTRICTED", "viewers": list(viewers)},
    )


def tool_result(response: Response) -> dict[str, Any]:
    result: dict[str, Any] = response.json()["toolResult"]
    return result


# --------------------------------------------------------------------------- 两半的对照


async def test_a_visibility_change_only_lands_after_approval(
    cogito_backed_client: HandlerClient,
) -> None:
    """单步里只有占位；批过之后同一份调用才真的写，且写的是批准时那一份。"""
    stub = stub_with_landing_value(*VIEWERS)
    client = cogito_backed_client(stub)

    pending = await step(client)

    placeholder = pending.json()["toolResults"][0]
    assert placeholder["ok"] is False
    assert placeholder["awaitingApproval"] is True
    assert placeholder["error"] == tools.AWAITING_APPROVAL_ERROR
    # 占位是真的没出去：本步只换了一枚对话令牌，没换写令牌，写端点更没碰过。
    assert [body["scope"] for body in stub.token_bodies] == [SCOPE_CHAT]
    assert stub.visibility_writes == []
    # 但工具确实已经交给了模型（说明书与校验共用同一份声明）。
    assert [tool["function"]["name"] for tool in stub.last_chat["tools"]] == [TOOL]

    approved = await execute(client)

    assert approved.status_code == 200
    result = tool_result(approved)
    assert result["ok"] is True
    assert result["awaitingApproval"] is False

    # 换令牌：作用域与受众都钉在这次审批上，审批号必须一起送出去。
    write_tokens = [body for body in stub.token_bodies if body["scope"] == SCOPE_ASSET_WRITE]
    assert write_tokens == [
        {
            "tenantID": TENANT_ID,
            "scope": SCOPE_ASSET_WRITE,
            "assetID": ASSET_ID,
            "approvalID": APPROVAL_ID,
        }
    ]

    # 写请求：没有 body（改什么在换令牌那一步就定死了），且拿的是写令牌。
    (write,) = stub.visibility_writes
    expected_path = ASSET_VISIBILITY_PATH.format(asset_id=ASSET_ID)
    assert (write.method, write.url.path) == ("PUT", expected_path)
    assert write.content == b""
    assert write.headers[SERVICE_TOKEN_HEADER] == f"tok-{SCOPE_ASSET_WRITE}"

    # 描述的是 cogito 回报的落地值（名单上两个人），不是模型请求的 PUBLIC：
    # 两者不一致时模型必须看得出来，否则它会以为自己改成了想要的样子。
    assert "2 个人可见" in result["content"]
    assert "PUBLIC" not in result["content"]
    for viewer in VIEWERS:  # 名单不回显：回显既没用又是数据外泄
        assert viewer not in result["content"]


async def test_the_write_token_is_cached_per_approval(cogito_backed_client: HandlerClient) -> None:
    """一次审批换一份能力：同一个审批号只换一次令牌，换了审批号就是另一枚。"""
    stub = stub_with_landing_value(*VIEWERS)
    client = cogito_backed_client(stub)

    await execute(client, key="visibility-key-0001")
    await execute(client, key="visibility-key-0002")  # 换个幂等键：同一个审批号，重跑一次
    await execute(client, approval_id=OTHER_APPROVAL_ID, key="visibility-key-0003")

    assert [body["approvalID"] for body in stub.token_bodies] == [APPROVAL_ID, OTHER_APPROVAL_ID]
    assert len(stub.visibility_writes) == 3  # 令牌省了两次，写还是老老实实发了三次


# --------------------------------------------------------------------------- 拒绝的两种性质


async def test_an_invalid_approval_is_a_final_refusal_not_a_retry(
    cogito_backed_client: HandlerClient,
) -> None:
    """审批不合规（403 + 500509）是终局：回 `ok=false` 的 200，不是让 cogito 重试整步的 503。"""
    stub = stub_with_landing_value(*VIEWERS)
    stub.visibility_status = 403
    stub.visibility_code = APPROVAL_INVALID_CODE
    client = cogito_backed_client(stub)

    response = await execute(client)

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is False
    assert result["error"] == errors.ErrorCode.INVALID_REQUEST.value
    assert "403" in result["content"]
    # 写是没有落地的（cogito 拒了），但请求确实发出去过——重试一百次也是同一个 403。
    assert len(stub.visibility_writes) == 1


async def test_our_own_broken_credential_stays_a_dependency_failure(
    cogito_backed_client: HandlerClient,
) -> None:
    """401 是**我们自己**配错/写错（令牌无效），必须留着 503 让人从日志里看见。"""
    stub = stub_with_landing_value(*VIEWERS)
    stub.visibility_status = 401
    stub.visibility_code = 300002
    client = cogito_backed_client(stub)

    response = await execute(client)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == errors.ErrorCode.DEPENDENCY_UNAVAILABLE.value


# --------------------------------------------------------------------------- 参数校验


@pytest.mark.parametrize(
    ("arguments", "fragment"),
    [
        ('{"visibility":"PUBLIC"}', "缺少必填参数 assetID"),
        (
            f'{{"assetID":"{ASSET_ID}","visibility":"SECRET"}}',
            "只能取 PRIVATE、RESTRICTED、PUBLIC",
        ),
        (
            f'{{"assetID":"{ASSET_ID}","visibility":"RESTRICTED","viewers":"某人"}}',
            "viewers 必须是数组",
        ),
        (
            f'{{"assetID":"{ASSET_ID}","visibility":"RESTRICTED","viewers":["某人"]}}',
            "viewers[0] 必须是 UUID 格式",
        ),
        (
            f'{{"assetID":"{ASSET_ID}","visibility":"PUBLIC","mode":"悄悄改"}}',
            "不认识的参数 mode",
        ),
    ],
)
async def test_visibility_arguments_are_rejected_before_any_outbound_call(
    cogito_backed_client: HandlerClient, arguments: str, fragment: str
) -> None:
    """参数不合法时一行出网代码都不跑：说明书写着三个参数，多一个少一个都不行。"""
    stub = stub_with_landing_value(*VIEWERS)
    client = cogito_backed_client(stub)

    response = await execute(client, arguments=arguments)

    assert response.status_code == 200
    result = tool_result(response)
    assert result["ok"] is False
    assert fragment in result["content"]
    assert stub.token_bodies == []
    assert stub.visibility_writes == []


# --------------------------------------------------------------------------- 缺审批的兜底


async def test_a_write_tool_without_an_approval_never_reaches_core(
    make_cogito: MakeCogito, database: Database
) -> None:
    """直接把写工具跑在「没有审批号」的上下文里（例如误把 `requires_approval` 摘掉）。

    契约要求 `approvalID` 必填，所以这条路径从 HTTP 进不来；这里是在**直接调工具**，
    证明兜底那一条确实会把写入挡在本进程内——它不该因为「进不来」就悄悄失效。
    """
    stub = AgentStub()
    context = tools.ToolContext(
        tenant_id=TENANT_ID,
        embed_model=EMBED_MODEL,
        cogito=make_cogito(stub),
        database=database,
        settings=make_settings(),
        memory_writes=tools.WriteBudget(remaining=1),
    )

    result = await tools.invoke(
        context,
        AgentToolCall(id="call-1", name=TOOL, arguments=PUBLIC_ARGUMENTS),
        allowed=[TOOL],
        max_chars=8000,
        approved=True,
    )

    assert result.ok is False
    assert "审批" in result.content
    assert stub.paths == []  # 一次出网都没有
