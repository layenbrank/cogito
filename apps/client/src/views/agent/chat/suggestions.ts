import { type SuggestionAdapter, type ThreadAssistantMessagePart, type ThreadMessage } from '@assistant-ui/react'
import { PLAN_PART_NAME } from '@cogito/chat/adapters/chat-model'
import type { ChatPlanEntry } from '@cogito/chat/ports'

/**
 * Follow-up 建议：本地启发式，不额外打一次 LLM。
 *
 * assistant-ui 在回合收束（settled）后调 `generate`，这里只读最后一条助手消息
 * （历史形态的 part，工具只有 `isError`，没有运行态 `status`）：
 * - 工具失败 → 重试类
 * - 计划有未完成项 → 续做计划
 * - 否则 → 收尾类
 */

const RETRY = [
  { prompt: '再试一次' },
  { prompt: '换个方式重试刚才失败的步骤' },
  { prompt: '跳过失败的步骤，继续后续任务' }
]

const CONTINUE_PLAN = [{ prompt: '继续执行计划里的剩余步骤' }]

const DONE = [
  { prompt: '继续下一步' },
  { prompt: '总结一下刚才的结果和改动' },
  { prompt: '把这次改动整理成一次提交' }
]

function hasPlanPending(parts: readonly ThreadAssistantMessagePart[]): boolean {
  return parts.some(function (part) {
    if (part.type !== 'data' || part.name !== PLAN_PART_NAME) return false
    const data = part.data as { entries?: readonly ChatPlanEntry[] }
    return (data.entries ?? []).some(function (entry) {
      return entry.status !== 'completed'
    })
  })
}

function hasToolError(parts: readonly ThreadAssistantMessagePart[]): boolean {
  return parts.some(function (part) {
    return part.type === 'tool-call' && part.isError === true
  })
}

function findSuggestions(messages: readonly ThreadMessage[]) {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') return []
  if (hasToolError(last.content)) return RETRY
  if (hasPlanPending(last.content)) return CONTINUE_PLAN
  return DONE
}

function createLocalSuggestionAdapter(): SuggestionAdapter {
  return {
    generate({ messages }) {
      return Promise.resolve(findSuggestions(messages))
    }
  }
}

export { createLocalSuggestionAdapter }
