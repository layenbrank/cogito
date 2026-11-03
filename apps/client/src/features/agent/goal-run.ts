/**
 * 目标推进：围绕一个可验证终态**自动续跑**，中途不打断用户。
 *
 * 为什么需要它：计划执行时模型经常停下来等确认，用户不在电脑旁就只能干等。
 * Qoder 用「最大回合数」解决这个问题 —— 给足预算、跑满为止、收尾统一交代。
 * 这里复刻同样的语义：
 *
 * - 一轮结束 → 若模型报告 `GOAL_CONTINUE` 且预算未尽 → 自动发下一轮；
 * - `GOAL_DONE` / 预算用尽 / 用户中止 → 停；
 * - 状态按**线程**存（`Map<threadID, GoalRun>`）：多个会话/工作区可以同时各自推进，
 *   切走线程不影响那条线程的后台轮次。
 *
 * 审批档：目标推进无人值守，工具一弹审批就卡住，所以启动时强制切到「自动审批」，
 * 全部目标都结束后再恢复启动前的档位（用户中途手动改过就以他的为准）。
 */
import type { ThreadMessage } from '@assistant-ui/react'
import { useCallback, useSyncExternalStore } from 'react'

import { readApprovalModeFor, writeApprovalModeFor } from '@/features/agent/approval'
import type { ApprovalMode } from '@/features/persist'

/** 最大轮数（含首轮）：够长任务收敛，又不至于无限烧 token */
const DEFAULT_BUDGET = 6

/** 供 UI 选择的轮次档位：短任务 3 轮、常规 6 轮、大改造 12 轮 */
const GOAL_BUDGET_OPTIONS = [3, 6, 12] as const

/**
 * 「下一次发消息」用的轮次预算。
 *
 * 轮次是**每次发消息各自的**决定（这一条任务要跑几轮），不是会话级设置：
 * 上一条小任务 3 轮，下一条大重构可能 12 轮。所以它单独存、发送时读取，
 * 与 `GoalRun`（正在跑的那一轮的预算快照）分开，改默认值不会打断进行中的推进。
 */
const BUDGET_KEY = 'cogito:agent:goal-budget'
const budgetListeners = new Set<() => void>()

function readNextGoalBudget(): number {
  try {
    const raw = window.localStorage.getItem(BUDGET_KEY)
    const value = raw ? Number(raw) : Number.NaN
    if (GOAL_BUDGET_OPTIONS.includes(value as (typeof GOAL_BUDGET_OPTIONS)[number])) {
      return value
    }
  } catch (error) {
    console.warn('[agent/goal] 读轮次预算失败，按默认值处理:', error)
  }
  return DEFAULT_BUDGET
}

function writeNextGoalBudget(budget: number): void {
  try {
    window.localStorage.setItem(BUDGET_KEY, String(budget))
  } catch (error) {
    console.warn('[agent/goal] 写轮次预算失败:', error)
  }
  for (const listener of [...budgetListeners]) listener()
}

function subscribeGoalBudget(listener: () => void): () => void {
  budgetListeners.add(listener)
  return function () {
    budgetListeners.delete(listener)
  }
}

interface GoalProgress {
  done: number
  total: number
}

interface GoalRun {
  threadID: string
  /** 用户给的终态（写进续跑指令，避免长上下文里漂移） */
  objective: string
  /** 最大轮数（含首轮） */
  budget: number
  /** 已完成的轮数 */
  used: number
  /** 模型最近一次自报的「达成 n/m」；供右栏进度展示 */
  progress: GoalProgress | null
}

const runs = new Map<string, GoalRun>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of [...listeners]) listener()
}

function subscribeGoalRun(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function readGoalRun(threadID: string): GoalRun | null {
  return runs.get(threadID.trim()) ?? null
}

/** 供 `useSyncExternalStore` 订阅：预算进度 / 是否在推进改一处全屏刷新 */
function useGoalRun(threadID: string | null): GoalRun | null {
  const read = useCallback(
    function () {
      return threadID ? readGoalRun(threadID) : null
    },
    [threadID]
  )
  return useSyncExternalStore(subscribeGoalRun, read, read)
}

/** 每个会话启动前被我们改掉的审批档；多会话并行推进时必须分开记 */
const approvalToRestore = new Map<string, ApprovalMode>()

/**
 * 目标推进要无人值守，工具一弹审批整轮就停在那儿等。
 * 返回是否真的改过档位（UI 据此提示用户）。
 */
function ensureGoalApproval(threadID: string): boolean {
  const current = readApprovalModeFor(threadID)
  if (current === 'auto') return false
  approvalToRestore.set(threadID, current)
  writeApprovalModeFor(threadID, 'auto')
  return true
}

/** 只恢复这个会话；用户中途自己改过就不动 —— “他说了算”更重要 */
function restoreGoalApproval(threadID: string): void {
  const original = approvalToRestore.get(threadID)
  if (!original) return
  approvalToRestore.delete(threadID)
  if (readApprovalModeFor(threadID) === 'auto') {
    writeApprovalModeFor(threadID, original)
  }
}

/** 启动目标推进；返回是否把审批档改成了自动 */
function startGoalRun(threadID: string, objective: string, budget = DEFAULT_BUDGET): boolean {
  const id = threadID.trim()
  const switched = ensureGoalApproval(id)
  runs.set(id, { threadID: id, objective, budget: Math.max(1, budget), used: 0, progress: null })
  notify()
  return switched
}

/**
 * 停一个线程的目标推进；**不传** threadID 才是全停。
 *
 * 空串当 no-op 处理 —— 调用方（可能还没选出线程）传空值时不能误伤其它线程的目标。
 */
function stopGoalRun(threadID?: string): void {
  if (threadID === undefined) {
    if (runs.size === 0) return
    for (const id of runs.keys()) restoreGoalApproval(id)
    runs.clear()
    notify()
    return
  }
  const id = threadID.trim()
  if (!id) return
  if (!runs.delete(id)) return
  // 只恢复这个会话的审批：其它会话可能还在推进，不能一起还原
  restoreGoalApproval(id)
  notify()
}

/**
 * 记一轮完成，返回是否还有预算继续。
 *
 * 首轮由「开始执行」直接发出，不经过这里 —— 所以本轮结束时先自增再判断。
 */
function advanceGoalRun(threadID: string): boolean {
  const id = threadID.trim()
  const run = runs.get(id)
  if (!run) return false
  const next = { ...run, used: run.used + 1 }
  runs.set(id, next)
  notify()
  return next.used < next.budget
}

/** 模型收尾标记：全部达成 / 仍需继续 */
const GOAL_DONE = /(^|\n)\s*GOAL_DONE\b/
const GOAL_CONTINUE = /(^|\n)\s*GOAL_CONTINUE\b/

/**
 * 「达成 n/m」：只认带「达成/完成」前缀或「n/m 项」后缀的写法，
 * 避开正文里 `1/6 轮` 这类轮次数字误判。
 */
const PROGRESS_PATTERNS = [
  /(?:达成|完成)[^\d\n]{0,6}(\d+)\s*\/\s*(\d+)/,
  /(\d+)\s*\/\s*(\d+)\s*(?:项|条)/
]

function parseGoalProgress(text: string): GoalProgress | null {
  for (const pattern of PROGRESS_PATTERNS) {
    const matched = text.match(pattern)
    if (!matched) continue
    const done = Number(matched[1])
    const total = Number(matched[2])
    if (!Number.isInteger(done) || !Number.isInteger(total)) return null
    if (total <= 0 || done > total) return null
    return { done, total }
  }
  return null
}

/** 记录本轮自报进度；新文本里没有这个写法就沿用上一次，不清零 */
function setGoalProgress(threadID: string, progress: GoalProgress | null): void {
  if (!progress) return
  const id = threadID.trim()
  const run = runs.get(id)
  if (!run) return
  if (run.progress?.done === progress.done && run.progress.total === progress.total) return
  runs.set(id, { ...run, progress })
  notify()
}

function findGoalSignal(text: string): 'done' | 'continue' | null {
  if (GOAL_DONE.test(text)) return 'done'
  if (GOAL_CONTINUE.test(text)) return 'continue'
  return null
}

function findLastAssistant(messages: readonly ThreadMessage[]): ThreadMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return messages[index]
  }
  return null
}

function readAssistantText(message: ThreadMessage): string {
  return message.content
    .filter(function (part) {
      return part.type === 'text'
    })
    .map(function (part) {
      return part.type === 'text' ? part.text : ''
    })
    .join('\n')
    .trim()
}

/** 用户中止 / 出错：这一轮不是模型自己跑完的，不能当成「未达成」继续 */
function isAbortedRun(message: ThreadMessage): boolean {
  return message.status?.type === 'incomplete'
}

/** 续跑指令：把轮次与终态再点一遍，别指望模型从长上下文里自己捞 */
function buildContinuePrompt(run: GoalRun): string {
  return [
    `继续推进目标（第 ${run.used + 1}/${run.budget} 轮）。`,
    `目标：${run.objective}`,
    '先对照验收标准自评当前状态，然后直接补齐未达成项 —— 不要询问用户，能自己决定的就自己定并记账。',
    '本轮结束按约定汇报（本轮做了什么 + 达成 n/m），并单独输出 GOAL_DONE 或 GOAL_CONTINUE。'
  ].join('\n')
}

export {
  advanceGoalRun,
  buildContinuePrompt,
  DEFAULT_BUDGET,
  findGoalSignal,
  findLastAssistant,
  GOAL_BUDGET_OPTIONS,
  isAbortedRun,
  parseGoalProgress,
  readAssistantText,
  readGoalRun,
  readNextGoalBudget,
  subscribeGoalBudget,
  writeNextGoalBudget,
  setGoalProgress,
  startGoalRun,
  stopGoalRun,
  subscribeGoalRun,
  useGoalRun
}
export type { GoalProgress, GoalRun }
