"""`/internal/v1/agents/*` 的请求/响应模型（契约 `spec/internal.yaml`）。

`steps`、`tool-executions` 与 `memories` 三族模型都放在这里：它们都要与同一份契约逐字对齐，
分成多个文件反而会让人以为「契约形状可以按端点切」。

字段名直接抄契约（camelCase，用 `alias` 而不是 `alias_generator`：契约里是 `tenantID` /
`toolCallID`，通用驼峰转换会生成 `tenantId`，对不上）。

`extra="forbid"` 是刻意的，而且这里比 RAG 那几个模型更关键：本端点的**请求体是 cogito 从上一轮
响应里攒出来的**（历史 + 工具结果）。两侧形状只要漂一点，cogito 攒出来的历史就会在下一步
被拒；宁可当场 400 把版本不一致暴露出来，也不要静默丢掉半个工具调用。

**`arguments` 是字符串**（`"{\\"query\\":\\"…\\"}"`）而不是对象：这就是 OpenAI 工具调用的线格式，
保持原样能让 cogito 不必在中间反序列化再序列化一遍，历史可以整条回灌。
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

_CONTRACT = ConfigDict(extra="forbid", populate_by_name=True)


class AgentToolCall(BaseModel):
    """契约 `AgentToolCall`：模型要求调用的一次工具。"""

    model_config = _CONTRACT

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    #: 缺省时按 `{}` 处理：OpenAI 的无参调用就是不给 `arguments`，不是给一个空串
    #: （空串不是合法 JSON，会被判成参数错，那是假故障）。
    arguments: str = "{}"
    tool_call_type: str | None = Field(default=None, alias="toolCallType")

    @classmethod
    def from_parts(
        cls,
        *,
        call_id: str,
        name: str,
        arguments: str = "{}",
        tool_call_type: str | None = None,
    ) -> AgentToolCall:
        return cls.model_validate(
            {
                "id": call_id,
                "name": name,
                "arguments": arguments,
                "tool_call_type": tool_call_type,
            }
        )

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentMessage(BaseModel):
    """契约 `AgentMessage`：一条对话消息。"""

    model_config = _CONTRACT

    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = None
    #: `None` 与 `[]` 在线上是两个意思，不能合并：`None` 表示「这条消息与工具无关」
    #: （user/system/tool），`[]` 表示「助手这一步没有再要工具」。
    tool_calls: list[AgentToolCall] | None = Field(default=None, alias="toolCalls")
    tool_call_id: str | None = Field(default=None, alias="toolCallID")

    @classmethod
    def from_parts(
        cls,
        *,
        role: str,
        content: str | None = None,
        tool_calls: list[AgentToolCall] | None = None,
        tool_call_id: str | None = None,
    ) -> AgentMessage:
        return cls.model_validate(
            {
                "role": role,
                "content": content,
                "tool_calls": tool_calls,
                "tool_call_id": tool_call_id,
            }
        )

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentToolResult(BaseModel):
    """契约 `AgentToolResult`：一次工具调用的结果，与 `message.toolCalls` 同序一一对应。"""

    model_config = _CONTRACT

    tool_call_id: str = Field(alias="toolCallID")
    name: str
    ok: bool
    content: str
    #: 失败时的稳定机器码。只进 cogito 的日志与审计，**不喂模型**（模型读 `content` 里的白话）。
    error: str | None = None
    #: 「这一次调用没有执行」的占位标记：工具需要人工审批，本步只留了占位结果
    #: （见 `tools.invoke` 的 `approved`）。cogito 看到它就去走审批通道，批准后再从
    #: `/agents/tool-executions` 真的执行。缺省 false 表示「按普通结果处理」。
    awaiting_approval: bool = Field(default=False, alias="awaitingApproval")

    @classmethod
    def from_parts(
        cls,
        *,
        tool_call_id: str,
        name: str,
        ok: bool,
        content: str,
        error: str | None = None,
        awaiting_approval: bool = False,
    ) -> AgentToolResult:
        return cls.model_validate(
            {
                "tool_call_id": tool_call_id,
                "name": name,
                "ok": ok,
                "content": content,
                "error": error,
                "awaiting_approval": awaiting_approval,
            }
        )

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentUsage(BaseModel):
    """契约 `AgentUsage`：上游给的 token 用量；上游没给时三个值都是 0（不编造）。"""

    model_config = _CONTRACT

    prompt_tokens: int = Field(alias="promptTokens", ge=0)
    completion_tokens: int = Field(alias="completionTokens", ge=0)
    total_tokens: int = Field(alias="totalTokens", ge=0)

    @classmethod
    def from_parts(
        cls, *, prompt_tokens: int, completion_tokens: int, total_tokens: int
    ) -> AgentUsage:
        return cls.model_validate(
            {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }
        )

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentStepRequest(BaseModel):
    """契约 `AgentStepRequest`：cogito 说「目标 + 到目前为止的历史 + 可用工具」。"""

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    objective: str = Field(min_length=1)
    model: str = Field(min_length=1)
    embed_model: str = Field(alias="embedModel", min_length=1)
    history: list[AgentMessage] = Field(default_factory=list)
    allowed_tools: list[str] = Field(default_factory=list, alias="allowedTools")
    #: 还剩几步（含本步）。`<= 1` 时本步不给工具——预算用尽前必须先收一条结论。
    remaining_steps: int | None = Field(default=None, alias="remainingSteps", ge=0)


class AgentStepResponse(BaseModel):
    """契约 `AgentStepResponse`：这一步的产出，cogito 追加进历史后决定要不要再来一步。"""

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    #: 当且仅当 `message.tool_calls` 为空时为 true。
    finished: bool
    message: AgentMessage
    tool_results: list[AgentToolResult] = Field(alias="toolResults")
    usage: AgentUsage

    @classmethod
    def from_parts(
        cls,
        *,
        finished: bool,
        message: AgentMessage,
        tool_results: list[AgentToolResult],
        usage: AgentUsage,
    ) -> AgentStepResponse:
        return cls.model_validate(
            {
                "schema_version": 1,
                "finished": finished,
                "message": message,
                "tool_results": tool_results,
                "usage": usage,
            }
        )

    def wire(self) -> dict[str, Any]:
        """按契约字段名导出。

        `exclude_none=True` 不是省字节，是为了**合契约**：契约里 `content` 是 `type: string`，
        不给它加 `nullable`，所以「助手只要工具、没有正文」时这个键必须缺席，而不是 `null`。
        `toolResults` 是必填，空列表照常输出（`[]` 不是 `None`）。
        """
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentToolExecutionRequest(BaseModel):
    """契约 `AgentToolExecutionRequest`：cogito 说「这次调用批了，去执行它」。

    载荷里**没有**「谁批的/批没批」这类证据：审批台账在 cogito 那边，ai-worker 读不到也不该读。
    这里只用 `approvalID` 拼日志与幂等键（`Idempotency-Key` 由 cogito 另外给），
    准入只认 [`ai_worker.agent_runtime.router`] 里那两条规则（工具声明了需要审批 + 在白名单里）。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    #: cogito 的任务台账 id（审计与日志用）。
    task_id: str = Field(alias="taskID", min_length=1)
    #: cogito 的审批标识（确定性派生自 `<taskID>:<步骤>:<第几次调用>`）。
    approval_id: str = Field(alias="approvalID", min_length=1)
    #: 与 `AgentStepRequest.embed_model` 同义：需要算向量的工具（写记忆）用它。
    embed_model: str = Field(alias="embedModel", min_length=1)
    #: 白名单是**必填**（契约如此）：少给一份就等于把「不在名单里」判成「没给名单」。
    allowed_tools: list[str] = Field(alias="allowedTools")
    tool_call: AgentToolCall = Field(alias="toolCall")


class AgentToolExecutionResponse(BaseModel):
    """契约 `AgentToolExecutionResponse`：这一次调用的最终结果（`ok=false` 也可能是正常结果）。"""

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tool_result: AgentToolResult = Field(alias="toolResult")

    @classmethod
    def from_parts(cls, *, tool_result: AgentToolResult) -> AgentToolExecutionResponse:
        return cls.model_validate({"schema_version": 1, "tool_result": tool_result})

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentToolInvocationRequest(BaseModel):
    """契约 `AgentToolInvocationRequest`：cogito 说「同步执行一次**不需要审批**的工具」。

    与 `AgentToolExecutionRequest` 是两条不同的路径：那条是审批通道的执行半边（只收
    声明了需要审批的工具），这条是**直通通道**（只收不需要审批的只读工具，写工具一律 400）。
    它服务 MCP 的 `tools/call`：MCP 是同步协议，没有人工审批这半程，所以这条路径上的
    工具只能是「一步就能出结果、没有持久副作用」的只读工具。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    #: 与 `AgentStepRequest.embed_model` 同义：检索/召回的向量边界按它划分。
    embed_model: str = Field(alias="embedModel", min_length=1)
    #: 白名单是**必填**（与 tool-executions 同口径）：少给一份就等于把「不在名单里」
    #: 判成「没给名单」。
    allowed_tools: list[str] = Field(alias="allowedTools")
    tool_call: AgentToolCall = Field(alias="toolCall")


class AgentToolInvocationResponse(BaseModel):
    """契约 `AgentToolInvocationResponse`：这一次调用的最终结果（`ok=false` 也可能是正常结果）。"""

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tool_result: AgentToolResult = Field(alias="toolResult")

    @classmethod
    def from_parts(cls, *, tool_result: AgentToolResult) -> AgentToolInvocationResponse:
        return cls.model_validate({"schema_version": 1, "tool_result": tool_result})

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)


class AgentMemoryRequest(BaseModel):
    """契约 `AgentMemoryRequest`：cogito 说「这个任务收尾了，把结论记下来」。

    摘要正文由 ai-worker 组装（[`memory.summarise`]），所以这里给的是**零件**而不是成品文本：
    组装规则是服务端的事，cogito 只管把事实交出来——和「系统提示词归服务端」（P9b）同一个立场。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    tenant_id: str = Field(alias="tenantID", min_length=1)
    #: 任务标识。摘要在库里的 id 由它确定性派生，所以它也是幂等键的一半。
    task_id: str = Field(alias="taskID", min_length=1)
    objective: str = Field(min_length=1)
    #: 收尾时模型的最后一条正文（cogito 只在非空时才会调本端点）。
    answer: str = Field(min_length=1)
    #: 规模信息，进摘要正文的末行，让之后读到这条记忆的模型知道它有多"重"。
    steps: int = Field(ge=0)
    tool_calls: int = Field(alias="toolCalls", ge=0)
    #: 嵌入模型：记忆的召回边界按它划分，必须与检索面（`embedModel`）一致。
    embed_model: str = Field(alias="embedModel", min_length=1)


class AgentMemoryResponse(BaseModel):
    """契约 `AgentMemoryResponse`：记下来的那条记忆的 id。

    `created` 区分「这次真写了」与「这条记忆早就在库里」——重投同一个任务时是后者。
    两种都算成功：cogito 的调用方只关心「这条任务的结论有没有落进长期记忆」。
    """

    model_config = _CONTRACT

    schema_version: Literal[1] = Field(alias="schemaVersion")
    memory_id: UUID = Field(alias="memoryID")
    created: bool

    @classmethod
    def from_parts(cls, *, memory_id: UUID, created: bool) -> AgentMemoryResponse:
        return cls.model_validate({"schema_version": 1, "memory_id": memory_id, "created": created})

    def wire(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json", exclude_none=True)
