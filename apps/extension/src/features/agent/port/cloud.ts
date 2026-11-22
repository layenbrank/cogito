/**
 * 云端兜底：直连网关 `POST /gateway/chat/completions`（OpenAI 兼容，`stream` 走 SSE）。
 *
 * ## 这条路的定位
 *
 * 没有桌面端（或它没开 agent 代理）时的**降级执行者**：只出文本，没有工具、没有审批。
 * 「降级」必须在界面上说出来 —— 用户以为在跟全能力 agent 说话、结果它连文件都读不了，
 * 比直接报错更糟。
 *
 * ## 为什么单独成文件而不是塞进 `model.ts`
 *
 * 两条路的失败模式完全不同：桥路的错误是「本机 19828 连不上 / 令牌不对」，云路的错误是
 * 「没登录 / 配额用尽 / 上游 4xx」。混在一个模块里，排查时第一眼看到的是别人的日志。
 */

import type {
  ChatModelPort,
  ChatRunInput,
  ChatRunMessage,
  ChatStreamEvent,
  ChatTarget
} from '@cogito/chat/ports'

import { findPref } from '@/features/platform/prefs.ts'
import { findAuthToken } from '@/features/platform/secrets.ts'
import { findOwnBaseURL, requestJson } from '@/features/platform/http.ts'

/** 与 client 的 `GATEWAY_CHAT_PATH` 同一个后缀；baseURL 由 `VITE_COGITO` 提供 */
const CHAT_PATH = '/gateway/chat/completions'
const MODELS_PATH = '/gateway/models'
const QUOTA_PATH = '/gateway/quota/me'

interface GatewayModel {
  name: string
}

type ExecutorKind = 'bridge' | 'cloud' | 'none'

interface Executor {
  kind: ExecutorKind
  /** 给用户看的一句话（`kind === 'none'` 时是失败原因） */
  detail: string
}

let activeExecutor: Executor = { kind: 'none', detail: '尚未检测' }
const executorListeners = new Set<() => void>()

function publishExecutor(next: Executor): void {
  activeExecutor = next
  for (const listener of executorListeners) listener()
}

function findActiveExecutor(): Executor {
  return activeExecutor
}

function subscribeExecutor(listener: () => void): () => void {
  executorListeners.add(listener)
  return function () {
    executorListeners.delete(listener)
  }
}

/** 组织模型的目录：登录后才知道服务端配了哪些模型 */
async function findGatewayModels(): Promise<string[]> {
  const catalog = await requestJson<GatewayModel[]>(MODELS_PATH)
  return catalog.map(function (model) {
    return model.name
  })
}

interface GatewayDelta {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
}

/** 一轮的消息体：只发 role + content，工具 part 不参与重放 */
function toGatewayMessages(messages: readonly ChatRunMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter(function (message) {
      return Boolean(message.content.trim())
    })
    .map(function (message) {
      return { role: message.role, content: message.content }
    })
}

/** 读 OpenAI 风格的 SSE：`data: {...}` 与 `data: [DONE]` */
async function* readGatewayStream(
  response: Response,
  signal: AbortSignal
): AsyncGenerator<ChatStreamEvent> {
  const body = response.body
  if (!body) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (!signal.aborted) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })

      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const frame = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        const data = /^data: (.+)$/m.exec(frame)?.[1]
        if (data) {
          if (data.trim() === '[DONE]') return
          try {
            const parsed = JSON.parse(data) as GatewayDelta
            const delta = parsed.choices?.[0]?.delta
            if (delta?.reasoning_content) {
              yield { kind: 'reasoning', blockID: 'reasoning:run', text: delta.reasoning_content }
            }
            if (delta?.content) {
              yield { kind: 'text', blockID: 'text:run', text: delta.content }
            }
          } catch (error) {
            // 坏帧丢掉，别让整条流断掉；留痕否则「正文莫名缺失」无从查起
            console.warn('[agent/cloud] 丢弃一条坏帧:', error)
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
  } finally {
    void reader.cancel().catch(function () {
      // 已经关了
    })
  }
}

function buildCloudModelPort(): ChatModelPort {
  async function* run(
    input: ChatRunInput & ChatTarget,
    signal: AbortSignal
  ): AsyncGenerator<ChatStreamEvent> {
    const token = findAuthToken()
    if (!token) {
      throw new Error('未登录：云端兜底需要账号令牌，请到扩展设置里填写')
    }
    const messages = toGatewayMessages(input.messages)
    if (messages.length === 0) {
      yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
      return
    }

    const base = findOwnBaseURL()
    if (!base) {
      throw new Error('未配置云端地址：构建时缺少 VITE_COGITO')
    }

    const response = await fetch(`${base}${CHAT_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ model: input.model, messages, stream: true }),
      signal
    })
    if (!response.ok) {
      const detail = await response.text().catch(function () {
        return ''
      })
      // 配额/登录这类错误要原样带出来：它决定用户下一步去干什么
      throw new Error(`网关返回 ${response.status}${detail ? `：${detail.slice(0, 300)}` : ''}`)
    }

    yield* readGatewayStream(response, signal)
    // 用户点「停止」时流是被 abort 掐断的：报 aborted，别报 finish（那等于说「我说完了」）
    if (signal.aborted) {
      yield { kind: 'aborted', usage: {} }
      return
    }
    yield { kind: 'finish', finishReason: 'end_turn', usage: {} }
  }

  return {
    findTarget(): Promise<ChatTarget | null> {
      const agent = findPref('agent')
      if (!agent.model) return Promise.resolve(null)
      return Promise.resolve({ providerID: agent.providerID ?? 'cogito_gateway', model: agent.model })
    },
    run
  }
}

export {
  CHAT_PATH,
  MODELS_PATH,
  QUOTA_PATH,
  buildCloudModelPort,
  findActiveExecutor,
  findGatewayModels,
  publishExecutor,
  subscribeExecutor
}
export type { Executor, ExecutorKind, GatewayModel }
