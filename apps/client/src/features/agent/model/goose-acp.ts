/**
 * Goose ACP 对话的**旧路径适配器**。
 *
 * 会话机器已经全部搬进 `@/features/agent/acp/session`（一个会话一份实现），这里只剩
 * 「把控制器的产出换成旧 UI 认得的 `NormalizedChunk`」这一层。
 *
 * 它随旧工作台一起删：新路径走 `@/features/agent/port/model`（产 `ChatStreamEvent`）。
 */
import type { SessionNotification } from '@agentclientprotocol/sdk'

import { parseAcpSessionUpdate } from '@/features/agent/acp/normalize'
import { requestAcpPermission } from '@/features/agent/acp/permission'
import {
  respondToThreadApproval,
  respondToThreadElicitation,
  runThreadPrompt
} from '@/features/agent/acp/session'
import type { ChatMessage, NormalizedChunk, ProviderConfig } from '@/features/agent/types'

interface GooseChatParams {
  signal?: AbortSignal
  sessionID?: string
}

function findLatestUserText(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && message.content) return message.content
  }
  return ''
}

async function* chatGooseAcp(
  config: ProviderConfig,
  messages: ChatMessage[],
  params: GooseChatParams = {}
): AsyncGenerator<NormalizedChunk, void, unknown> {
  const threadID = params.sessionID?.trim()
  if (!threadID) {
    throw new Error('缺少会话 id，无法建立 goose ACP 会话')
  }

  const promptText = findLatestUserText(messages).trim()
  if (!promptText) {
    yield { done: true, finishReason: 'stop' }
    return
  }

  const systemText = messages
    .find(function (item) {
      return item.role === 'system' && item.content?.trim()
    })
    ?.content?.trim()

  for await (const item of runThreadPrompt(threadID, {
    text: promptText,
    systemText,
    providerID: config.kind,
    modelID: config.model,
    signal: params.signal
  })) {
    if (item.kind === 'stop') {
      yield {
        done: true,
        finishReason: item.stopReason === 'cancelled' ? 'cancelled' : 'stop'
      }
      return
    }

    if (item.kind === 'update') {
      // 旧归一化只看 `update` 字段，这里补一个壳给它（新路径直接吃 `update`）
      const chunk = parseAcpSessionUpdate({ sessionId: '', update: item.update } as SessionNotification)
      if (chunk) yield chunk
      continue
    }

    if (item.kind === 'approval') {
      const response = await requestAcpPermission(item.params)
      const optionId = response.outcome.outcome === 'selected' ? response.outcome.optionId : ''
      const options = item.event.kind === 'tool-approval-request' ? (item.event.options ?? []) : []
      const allowed = options.some(function (option) {
        return option.id === optionId && option.kind.startsWith('allow')
      })
      respondToThreadApproval(threadID, {
        toolCallId: item.params.toolCall.toolCallId,
        approved: allowed,
        ...(optionId ? { optionId } : {})
      })
      continue
    }

    // 旧路径没有追问 UI：如实按「取消」回答，别把这一轮挂死
    console.info('[goose-acp] 旧路径不支持结构化追问，已按取消回答')
    if (item.event.kind === 'elicitation-request') {
      respondToThreadElicitation(threadID, { elicitationId: item.event.elicitationId, action: 'cancel' })
    }
  }
}

export { chatGooseAcp }
