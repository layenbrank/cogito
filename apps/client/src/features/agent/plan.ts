/**
 * 计划快照：从 assistant-ui 消息里捞**最后一份** `plan` 数据部件。
 *
 * 客户端走 goose ACP：计划是 `session/update` 的 `plan` 事件（整份覆盖），
 * 经 `createChatModelAdapter` 落成 `data` 部件（`name === 'plan'`，载荷是 `entries`）。
 * 这与 studio 的 markdown 任务清单不同 —— 这里是结构化数据，不必再去正文里拆 `- [ ]`。
 *
 * 只读：计划由 goose 整份覆盖，本地勾选会被下一次计划抹掉 —— 给一个点了没用的勾选框
 * 不如不给。
 */
import type { ThreadMessage } from '@assistant-ui/react'

import type { ChatPlanEntry } from '@i-thinking/chat/ports'

const PLAN_PART_NAME = 'plan'

interface PlanSnapshot {
  entries: readonly ChatPlanEntry[]
  done: number
  total: number
}

function findLatestPlan(messages: readonly ThreadMessage[]): PlanSnapshot | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const parts = messages[messageIndex].content
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex]
      if (part.type !== 'data' || part.name !== PLAN_PART_NAME) continue
      const entries = (part.data as { entries?: readonly ChatPlanEntry[] }).entries ?? []
      if (entries.length === 0) return null
      return {
        entries,
        done: entries.filter(function (entry) {
          return entry.status === 'completed'
        }).length,
        total: entries.length
      }
    }
  }
  return null
}

export { findLatestPlan }
export type { PlanSnapshot }
