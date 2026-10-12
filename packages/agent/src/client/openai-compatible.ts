/**
 * OpenAI 兼容模型流客户端。
 *
 * 覆盖 OpenAI / DeepSeek / Qwen（dashscope compatible-mode）/ 智谱 / Ollama / LM Studio
 * 等走 `/chat/completions` + SSE 的供应商。中性 `Message` 在此转成 OpenAI wire 格式：
 * 助手消息带 `tool_calls`，工具结果拆成独立 `role: tool` 消息。
 */

import type { Usage } from '../events'
import type { Message, TextPart, ToolPart } from '../message'
import type { ModelDelta, ModelStream, ModelStreamRequest } from '../model'
import type { Tool } from '../tool'

interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface WireMessage {
  role: string
  content: string | null
  tool_calls?: WireToolCall[]
  tool_call_id?: string
}

interface WireTool {
  type: 'function'
  function: { name: string; description: string; parameters: unknown }
}

/** 中性消息 → OpenAI wire 消息。图片等多媒体在 P3（attachments）接入 */
function toWireMessages(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []

  for (const message of messages) {
    const text = message.parts
      .filter(function (part): part is TextPart {
        return part.type === 'text'
      })
      .map(function (part) {
        return part.text
      })
      .join('\n')
    const toolParts = message.parts.filter(function (part): part is ToolPart {
      return part.type === 'tool'
    })

    if (message.role === 'assistant' && toolParts.length > 0) {
      wire.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolParts.map(function (part) {
          return {
            id: part.toolCallId,
            type: 'function' as const,
            function: {
              name: part.toolName,
              arguments: JSON.stringify(part.input ?? {})
            }
          }
        })
      })
      for (const part of toolParts) {
        wire.push({
          role: 'tool',
          tool_call_id: part.toolCallId,
          content: typeof part.output === 'string' ? part.output : JSON.stringify(part.output ?? '')
        })
      }
    } else {
      wire.push({ role: message.role, content: text })
    }
  }

  return wire
}

function toWireTools(tools: Tool[]): WireTool[] {
  return tools.map(function (tool) {
    return {
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }
  })
}

/** 逐条产出 SSE `data:` 载荷（已剥掉前缀，`[DONE]` 跳过） */
async function* readSseData(response: Response): AsyncGenerator<string, void, unknown> {
  const body = response.body
  if (!body) throw new Error('模型响应无 body')

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')

        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload && payload !== '[DONE]') yield payload
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function parseArgs(raw: string, _toolName: string): unknown {
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toUsage(raw: unknown): Usage | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const usage = raw as {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  return {
    ...(usage.prompt_tokens === undefined ? {} : { inputTokens: usage.prompt_tokens }),
    ...(usage.completion_tokens === undefined
      ? {}
      : { outputTokens: usage.completion_tokens }),
    ...(usage.total_tokens === undefined ? {} : { totalTokens: usage.total_tokens })
  }
}

function createOpenAICompatibleStream(): ModelStream {
  return {
    async *stream(request: ModelStreamRequest): AsyncGenerator<ModelDelta, void, unknown> {
      const { provider, apiKey, model, system, messages, tools, signal } = request
      const url = `${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`

      const wireMessages: WireMessage[] = [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        ...toWireMessages(messages)
      ]

      const body: Record<string, unknown> = {
        model,
        stream: true,
        messages: wireMessages,
        ...(tools.length > 0 ? { tools: toWireTools(tools), tool_choice: 'auto' } : {})
      }
      if (provider.kind === 'openai' || provider.kind === 'deepseek') {
        body.stream_options = { include_usage: true }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...provider.headers
        },
        body: JSON.stringify(body),
        signal
      })

      if (!response.ok) {
        const detail = await response.text().catch(function () {
          return ''
        })
        throw new Error(`模型请求失败 (${response.status}): ${detail.slice(0, 500)}`)
      }

      let finishReason = ''
      let usage: Usage | undefined
      const toolCalls = new Map<number, { id: string; name: string; args: string }>()

      for await (const payload of readSseData(response)) {
        let chunk: {
          choices?: Array<{
            finish_reason?: string | null
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              reasoning?: string | null
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
          }>
          usage?: unknown
        }
        try {
          chunk = JSON.parse(payload) as typeof chunk
        } catch {
          continue
        }

        const choice = chunk.choices?.[0]
        const delta = choice?.delta

        if (delta?.content) {
          yield { kind: 'text', text: delta.content }
        }
        const reasoning = delta?.reasoning_content ?? delta?.reasoning
        if (reasoning) {
          yield { kind: 'reasoning', text: reasoning }
        }
        if (delta?.tool_calls) {
          for (const call of delta.tool_calls) {
            const index = call.index ?? 0
            const existing = toolCalls.get(index) ?? { id: '', name: '', args: '' }
            if (call.id) existing.id = call.id
            if (call.function?.name) existing.name = call.function.name
            if (call.function?.arguments) existing.args += call.function.arguments
            toolCalls.set(index, existing)
          }
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (chunk.usage) usage = toUsage(chunk.usage)
      }

      for (const call of toolCalls.values()) {
        yield {
          kind: 'tool-call',
          toolCallId: call.id || `${call.name}-${toolCalls.size}`,
          toolName: call.name,
          input: parseArgs(call.args, call.name)
        }
      }

      yield { kind: 'finish', finishReason: finishReason || 'stop', usage }
    }
  }
}

export { createOpenAICompatibleStream }
