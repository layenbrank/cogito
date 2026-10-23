/**
 * 右栏的派生量：运行阶段、引用文件、工具调用统计、最后活动时刻。
 *
 * 全是纯函数（测试才跑得起来 —— studio 的 vitest 只收 `src` 下的 `.ts` 测试，组件测不到），
 * 数据一律从消息里派生：消息已随会话落库，从这里算一次刷新 / 切会话 / 重放历史都是天然一致的，
 * 另存一份必然要在「谁是真源」上打架。
 */

import type { ThreadMessage } from '@assistant-ui/react'

import { isFailedToolPart } from './tool-stats.ts'
import { toAgentToolLabel } from '@/shared/agent-tools.ts'

/**
 * 只声明我们真正读的字段（理由同 `tool-stats.ts`：按 `type` 收窄后拿到的部件形状不一致，
 * 且运行时可能比类型声明多带一个 `status`）。用结构类型两边都能接。
 */
interface PartLike {
  type: string
  filename?: string
  toolName?: string
  result?: unknown
  isError?: boolean
  status?: { type: string }
  approval?: { approved?: boolean }
}

/** 引用过的文件：用户的 file / image part 就是引用名单（与提示词里的 attachments 同源） */
function collectReferences(messages: readonly ThreadMessage[]): string[] {
  const names: string[] = []

  for (const message of messages) {
    if (message.role !== 'user') continue

    for (const part of message.content as readonly PartLike[]) {
      if (part.type !== 'file' && part.type !== 'image') continue

      const name = part.filename
      if (name && !names.includes(name)) names.push(name)
    }
  }

  return names
}

type RunPhaseKind = 'idle' | 'approval' | 'tool' | 'thinking' | 'writing'

interface RunPhase {
  kind: RunPhaseKind
  label: string
}

const IDLE_PHASE: RunPhase = { kind: 'idle', label: '就绪' }
const APPROVAL_PHASE: RunPhase = { kind: 'approval', label: '等待审批' }
const THINKING_PHASE: RunPhase = { kind: 'thinking', label: '思考中' }
const WRITING_PHASE: RunPhase = { kind: 'writing', label: '输出中' }

/**
 * 待批 = 有审批请求但还没落结论。审批**优先于**运行态：这时候运行停在人手上，
 * 说「思考中」会让人干等（`approved === false` 是已拒绝，不算待批）。
 */
function isPendingApproval(part: PartLike): boolean {
  return part.approval !== undefined && part.approval.approved === undefined
}

/**
 * 工具还在跑：能读到状态就信状态；读不到（`ThreadMessage` 里的工具部件没有 `status` 字段）
 * 就看有没有结果 —— 没结果且没报错，就是在跑。
 */
function isToolRunning(part: PartLike): boolean {
  if (part.status !== undefined) return part.status.type === 'running'
  return part.result === undefined && part.isError !== true
}

function findLastAssistantParts(messages: readonly ThreadMessage[]): readonly PartLike[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant') return message.content as readonly PartLike[]
  }

  return null
}

/**
 * 运行阶段：只看**最后一条**助手消息的尾部部件（从后往前第一个说明问题的那个）。
 *
 * 为什么不看整段历史：阶段说的是「此刻在干什么」，翻历史只会把上一轮的旧状态捞出来。
 */
function findRunPhase(messages: readonly ThreadMessage[], isRunning: boolean): RunPhase {
  const parts = findLastAssistantParts(messages)

  if (parts) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]

      if (part.type === 'tool-call') {
        if (isPendingApproval(part)) return APPROVAL_PHASE
        if (isRunning && isToolRunning(part)) {
          return { kind: 'tool', label: `正在${toAgentToolLabel(part.toolName ?? '')}` }
        }
        continue
      }

      if (!isRunning || part.status?.type !== 'running') continue
      if (part.type === 'reasoning') return THINKING_PHASE
      if (part.type === 'text') return WRITING_PHASE
    }
  }

  // 在跑但还看不出动作（首包没到）：报「思考中」，别显示上一轮的旧状态
  return isRunning ? THINKING_PHASE : IDLE_PHASE
}

interface ToolCallCount {
  name: string
  label: string
  /** 累计次数（同一工具多次调用合并一行） */
  count: number
}

interface ToolCallSummary {
  total: number
  /** 失败次数，口径与折叠条一致（见 `tool-stats.ts`） */
  failed: number
  items: ToolCallCount[]
}

function summarizeToolCalls(messages: readonly ThreadMessage[]): ToolCallSummary {
  const counts = new Map<string, number>()
  let total = 0
  let failed = 0

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    for (const part of message.content as readonly PartLike[]) {
      if (part.type !== 'tool-call') continue

      total += 1
      if (isFailedToolPart(part)) failed += 1

      const name = part.toolName ?? ''
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  const items = Array.from(counts, function ([name, count]) {
    return { name, label: toAgentToolLabel(name), count }
  }).sort(function (left, right) {
    if (right.count !== left.count) return right.count - left.count
    // 次数相同时按工具名排：中文 label 的排序依赖 locale，测试与界面都会飘
    return left.name.localeCompare(right.name)
  })

  return { total, failed, items }
}

/**
 * 最后活动时刻：最后一条消息的创建时间。
 *
 * 落库时 `createdAt` 一并写进 payload（见 `@cogito/chat/adapters/thread-history`），
 * 所以刷新 / 切会话读回来的还是真实时间。
 */
function findLastActivityAt(messages: readonly ThreadMessage[]): Date | null {
  const last = messages[messages.length - 1]
  return last ? last.createdAt : null
}

export { collectReferences, findLastActivityAt, findRunPhase, summarizeToolCalls }
export type { RunPhase, RunPhaseKind, ToolCallCount, ToolCallSummary }
