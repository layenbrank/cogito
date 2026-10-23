"""对话协议的翻译层：契约的**扁平**消息 ↔ OpenAI 的**线格式**，以及上游响应的解析。

两侧形状本来就不同，这里只做翻译，不做业务判断：

* 契约（cogito ↔ compute）是扁平的：`{"id","name","arguments"}`，
  参数是 JSON **字符串**，cogito 不必反序列化就能整条存下再回灌；
* OpenAI 线格式是嵌套的：`{"id","type":"function","function":{"name","arguments"}}`，
  工具结果则是一条独立的 `{"role":"tool","tool_call_id","content"}` 消息。

翻译只发生在一个位置（本模块），所以「cogito 看到的历史」和「模型看到的历史」不可能各自漂移
——那类 bug 在别处表现为「模型莫名其妙地重复调用同一个工具」，极难排查。

上游响应的解析口径与 `providers.embeddings` 一致：**形状不对一律 503（可重试）**。
理由也一样：上游半截返回（网关截断、模型侧灰度）时把半成品当结论写进任务历史，
代价远大于重试一次。
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from compute import errors
from compute.agent_runtime.schemas import AgentMessage, AgentToolCall, AgentUsage

#: OpenAI 的工具调用类型。本阶段只有函数工具，所以是常量，不跟着上游字段乱传。
_TOOL_CALL_TYPE = "function"


@dataclass(frozen=True, slots=True)
class Completion:
    """一次对话模型调用的产出。"""

    message: AgentMessage
    usage: AgentUsage


def to_upstream(messages: Sequence[AgentMessage]) -> list[dict[str, Any]]:
    """把（契约形状的）消息翻成 OpenAI 线格式，供 `cogito_client.chat` 原样透传。"""
    wire: list[dict[str, Any]] = []
    for message in messages:
        if message.role == "assistant":
            # 只要了工具、没有正文时 `content` 必须是显式的 `null`：多数厂商要求这个键存在。
            item: dict[str, Any] = {"role": "assistant", "content": message.content}
            if message.tool_calls is not None:
                item["tool_calls"] = [_call_to_upstream(call) for call in message.tool_calls]
        elif message.role == "tool":
            item = {
                "role": "tool",
                "tool_call_id": message.tool_call_id,
                "content": message.content or "",
            }
        else:
            item = {"role": message.role, "content": message.content or ""}
        wire.append(item)
    return wire


def _call_to_upstream(call: AgentToolCall) -> dict[str, Any]:
    return {
        "id": call.id,
        "type": call.tool_call_type or _TOOL_CALL_TYPE,
        "function": {"name": call.name, "arguments": call.arguments},
    }


def parse_completion(payload: object) -> Completion:
    """解析 `POST /api/v1/service/chat/completions` 的裸 JSON。"""
    if not isinstance(payload, dict):
        raise _malformed("响应不是 JSON 对象")

    choices = payload.get("choices")
    if not isinstance(choices, list) or len(choices) != 1:
        # cogito 强制非流式且不传 `n`，所以「只有一条选择」是它的承诺；多了说明上游或网关
        # 的行为变了，挑第一条继续跑等于悄悄改变语义。
        count = len(choices) if isinstance(choices, list) else "非数组"
        raise _malformed(f"choices 期望恰好 1 条，实际 {count}")
    choice = choices[0]
    if not isinstance(choice, dict):
        raise _malformed("choices[0] 不是对象")

    message = choice.get("message")
    if not isinstance(message, dict):
        raise _malformed("choices[0].message 不是对象")

    role = message.get("role", "assistant")
    if role != "assistant":
        raise _malformed(f"choices[0].message.role 期望 assistant，实际 {role!r}")

    content = message.get("content")
    if content is not None and not isinstance(content, str):
        # 有些厂商会回「内容分片数组」。契约里 `content` 是字符串，翻译不了就别硬翻。
        raise _malformed("choices[0].message.content 不是字符串")

    return Completion(
        message=AgentMessage.from_parts(
            role="assistant",
            content=content,
            tool_calls=_tool_calls(message.get("tool_calls")),
        ),
        usage=_usage(payload.get("usage")),
    )


def _tool_calls(raw: object) -> list[AgentToolCall]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise _malformed("choices[0].message.tool_calls 不是数组")

    calls: list[AgentToolCall] = []
    for item in raw:
        if not isinstance(item, dict):
            raise _malformed("tool_calls 的元素不是对象")
        call_id = item.get("id")
        if not isinstance(call_id, str) or not call_id:
            raise _malformed("tool_calls[].id 缺失或不是字符串")
        function = item.get("function")
        if not isinstance(function, dict):
            raise _malformed("tool_calls[].function 缺失或不是对象")
        name = function.get("name")
        if not isinstance(name, str) or not name:
            raise _malformed("tool_calls[].function.name 缺失或不是字符串")
        kind = item.get("type")
        calls.append(
            AgentToolCall.from_parts(
                call_id=call_id,
                name=name,
                arguments=_arguments(function.get("arguments")),
                tool_call_type=kind if isinstance(kind, str) else None,
            )
        )
    return calls


def _arguments(raw: object) -> str:
    """参数原样保留字符串形态。

    少数厂商会把参数直接给成**对象**（不合 OpenAI 线格式，但很常见）；这里序列化回字符串
    而不是判失败——这只是模型输出的形态问题，让它按正常路径走下去（真参数不合法会在
    工具执行时变成一条 `ok=false`，模型照样有机会自己纠错）。
    """
    if raw is None:
        return "{}"
    if isinstance(raw, str):
        return raw
    if isinstance(raw, dict):
        return json.dumps(raw, ensure_ascii=False)
    raise _malformed("tool_calls[].function.arguments 不是字符串或对象")


def _usage(raw: object) -> AgentUsage:
    """读用量。上游没给就全 0；给了但值不是整数也当 0——用量只影响记账，
    为它把整个步骤判失败不划算（而且要重试一次同样的调用）。"""
    if not isinstance(raw, dict):
        return AgentUsage.from_parts(prompt_tokens=0, completion_tokens=0, total_tokens=0)

    prompt = _int_or_zero(raw.get("prompt_tokens"))
    completion = _int_or_zero(raw.get("completion_tokens"))
    total = _int_or_zero(raw.get("total_tokens")) or prompt + completion
    return AgentUsage.from_parts(
        prompt_tokens=prompt, completion_tokens=completion, total_tokens=total
    )


def _int_or_zero(value: object) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else 0


def _malformed(reason: str) -> errors.ApiError:
    return errors.dependency_unavailable(f"对话响应形状不合法：{reason}")
