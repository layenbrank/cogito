/**
 * 目标推进：围绕一个可验证终态**自动续跑**，中途不打断用户。
 *
 * 为什么需要它：计划执行时模型经常停下来等确认，用户不在电脑旁就只能干等。
 * Qoder 用「最大回合数」解决这个问题 —— 给足预算、跑满为止、收尾统一交代。
 * 这里复刻同样的语义：
 *
 * - 一轮结束 → 若模型报告 `GOAL_CONTINUE` 且预算未尽 → 自动发下一轮；
 * - `GOAL_DONE` / 预算用尽 / 用户中止 → 停；
 * - 状态按**线程**存，且**落库到 `agent_goal`**（见 `plan-store`）：刷新/重启后
 *   轮次、进度、审批恢复档都还在，不再是模块级 Map 里的易失状态。
 *
 * 审批档：目标推进无人值守，工具一弹审批就卡住，所以启动时强制切到「自动审批」，
 * 全部目标都结束后再恢复启动前的档位（用户中途手动改过就以他的为准）。
 */
import type { ThreadMessage } from '@assistant-ui/react'
import { useCallback, useSyncExternalStore } from 'react'

import { readApprovalModeFor, writeApprovalModeFor } from '@/features/agent/approval'
import type { GoalRecord, GoalStatus } from '@/features/agent/plan-store'
import {
  listGoals,
  readGoal,
  saveGoal,
  subscribePlanStore
} from '@/features/agent/plan-store'
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
  /** 用户给的终态（写进续跑指令，避免长上下文里漂移）；完整 prompt，不再截断 */
  objective: string
  /** 最大轮数（含首轮） */
  budget: number
  /** 已完成的轮数 */
  used: number
  /** 模型最近一次自报的「达成 n/m」；供右栏进度展示 */
  progress: GoalProgress | null
  /** running / exhausted 仍算「有进行中的目标」；paused / done 不再推进 */
  status: GoalStatus
}

/** 目标摘要上限：横幅只放一句话，完整 prompt 存在 detail 里 */
const SUMMARY_LIMIT = 120

interface GoalObjective {
  summary: string
  detail: string
}

/** 供 UI 订阅：预算进度 / 是否在推进改一处全屏刷新 */
function subscribeGoalRun(listener: () => void): () => void {
  return subscribePlanStore(listener)
}

function toGoalRun(threadID: string): GoalRun | null {
  const record = readGoal(threadID)
  if (!record) return null
  return {
    threadID: record.sessionID,
    objective: record.detail || record.summary,
    budget: record.budget,
    used: record.used,
    progress:
      record.progressTotal !== null && record.progressTotal > 0
        ? { done: record.progressDone ?? 0, total: record.progressTotal }
        : null,
    status: record.status
  }
}

/**
 * 同步读（`goal-auto-advance` 在流式回调里用，不能改成 async）。
 * `paused` / `done` 视为没有进行中的目标；`exhausted` 仍返回 —— UI 要显示
 * 「已用尽」以及实际跑了几轮。
 */
function readGoalRun(threadID: string): GoalRun | null {
  const run = toGoalRun(threadID.trim())
  if (!run) return null
  return run.status === 'paused' || run.status === 'done' ? null : run
}

function useGoalRun(threadID: string | null): GoalRun | null {
  const read = useCallback(
    function () {
      return threadID ? readGoalRun(threadID) : null
    },
    [threadID]
  )
  return useSyncExternalStore(subscribeGoalRun, read, read)
}

/**
 * 本轮归属：自动续跑发出/用户首发的 prompt 存在模块里（不落库 —— 它只对
 * 「当前这一轮」有效，重启后本来就不该再用旧 prompt 判插话）。
 */
const expectedPrompt = new Map<string, string>()

function rememberGoalPrompt(threadID: string, prompt: string): void {
  expectedPrompt.set(threadID.trim(), prompt.trim())
}

function forgetGoalPrompt(threadID: string): void {
  expectedPrompt.delete(threadID.trim())
}

function readGoalPrompt(threadID: string): string | null {
  return expectedPrompt.get(threadID.trim()) ?? null
}

/**
 * 目标推进要无人值守，工具一弹审批整轮就停在那儿等。
 * 返回是否真的改过档位（UI 据此提示用户）。
 */
function ensureGoalApproval(threadID: string): ApprovalMode | null {
  const current = readApprovalModeFor(threadID)
  if (current === 'auto') return null
  writeApprovalModeFor(threadID, 'auto')
  return current
}

/** 只恢复这个会话；用户中途自己改过就不动 —— “他说了算”更重要 */
function restoreGoalApproval(threadID: string, before: string | null): void {
  if (!before) return
  if (readApprovalModeFor(threadID) !== 'auto') return
  writeApprovalModeFor(threadID, before as ApprovalMode)
}

function normalizeObjective(objective: string | GoalObjective): GoalObjective {
  if (typeof objective === 'string') {
    const text = objective.trim()
    return { summary: text.slice(0, SUMMARY_LIMIT), detail: text }
  }
  const detail = objective.detail.trim()
  const summary = (objective.summary.trim() || detail).slice(0, SUMMARY_LIMIT)
  return { summary, detail: detail || summary }
}

/** 启动目标推进；返回是否把审批档改成了自动 */
function startGoalRun(
  threadID: string,
  objective: string | GoalObjective,
  budget = DEFAULT_BUDGET,
  prompt?: string
): boolean {
  const id = threadID.trim()
  const before = ensureGoalApproval(id)
  const normalized = normalizeObjective(objective)
  saveGoal({
    sessionID: id,
    summary: normalized.summary,
    detail: normalized.detail,
    budget: Math.max(1, budget),
    used: 0,
    progressDone: null,
    progressTotal: null,
    status: 'running',
    approvalBefore: before
  })
  if (prompt) rememberGoalPrompt(id, prompt)
  return before !== null
}

/**
 * 停一个线程的目标推进；**不传** threadID 才是全停。
 *
 * `null` / 空串一律当 no-op —— 调用方（可能还没选出线程）传空值时必须
 * 不能崩（以前 `threadID.trim()` 直接 TypeError），也不能误伤其它线程的目标。
 */
function stopGoalRun(threadID?: string | null): void {
  // `null` 当 no-op：调用方（aside 的 `threadID ?? undefined` 之前）可能传空值
  if (threadID === null) return
  if (threadID === undefined) {
    const active = [...expectedPrompt.keys()]
    for (const id of active) forgetGoalPrompt(id)
    // 全停：把所有进行中的目标标记暂停（exhausted 也一并收尾）
    for (const record of collectActiveGoals()) {
      saveGoal({ sessionID: record.sessionID, status: 'paused' })
      restoreGoalApproval(record.sessionID, record.approvalBefore)
      forgetGoalPrompt(record.sessionID)
    }
    return
  }
  const id = threadID.trim()
  if (!id) return
  const record = readGoal(id)
  if (!record || record.status === 'paused' || record.status === 'done') return
  saveGoal({ sessionID: id, status: 'paused' })
  restoreGoalApproval(id, record.approvalBefore)
  forgetGoalPrompt(id)
}

/** 缓存里所有还在推进（running / exhausted）的目标 */
function collectActiveGoals(): GoalRecord[] {
  return listGoals().filter(function (record) {
    return record.status === 'running' || record.status === 'exhausted'
  })
}

/**
 * 记一轮完成，返回是否还有预算继续。
 *
 * 首轮由「开始执行」直接发出，不经过这里 —— 所以本轮结束时先自增再判断。
 */
function advanceGoalRun(threadID: string): boolean {
  const id = threadID.trim()
  const record = readGoal(id)
  if (!record || record.status !== 'running') return false
  const used = record.used + 1
  const exhausted = used >= record.budget
  saveGoal({ sessionID: id, used, status: exhausted ? 'exhausted' : 'running' })
  if (exhausted) {
    restoreGoalApproval(id, record.approvalBefore)
    forgetGoalPrompt(id)
  }
  return !exhausted
}

/** 模型收尾标记：全部达成 / 仍需继续 */
const GOAL_DONE = /(^|\n)[ \t]*(?:#{1,6}[ \t]*|[-*+][ \t]*)?_*GOAL_DONE_*\b/
const GOAL_CONTINUE = /(^|\n)[ \t]*(?:#{1,6}[ \t]*|[-*+][ \t]*)?_*GOAL_CONTINUE_*\b/

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
  const record = readGoal(id)
  if (!record) return
  if (record.progressDone === progress.done && record.progressTotal === progress.total) return
  saveGoal({
    sessionID: id,
    progressDone: progress.done,
    progressTotal: progress.total
  })
}

/**
 * 归一化后再匹配：模型常把收尾标记写成 `**GOAL_DONE**`、`` `GOAL_DONE` ``、
 * 「GOAL_DONE。」或小写 —— 旧实现只认行首裸写，会把「已完成」误报成「已停」。
 */
function findGoalSignal(text: string): 'done' | 'continue' | null {
  const normalized = text.replace(/[`*~"']/g, '').toUpperCase()
  if (GOAL_DONE.test(normalized)) return 'done'
  if (GOAL_CONTINUE.test(normalized)) return 'continue'
  return null
}

function findLastAssistant(messages: readonly ThreadMessage[]): ThreadMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') return messages[index]
  }
  return null
}

function readMessageText(message: ThreadMessage): string {
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

function readAssistantText(message: ThreadMessage): string {
  return readMessageText(message)
}

/** 最后一条用户消息正文：用来判断「这一轮是不是目标轮」 */
function findLastUserText(messages: readonly ThreadMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const text = readMessageText(message)
    if (text) return text
  }
  return null
}

/** 最后一条消息是不是用户插话（排队消息发出后也会落成 user 消息） */
function isUserInterjection(messages: readonly ThreadMessage[]): boolean {
  const last = messages[messages.length - 1]
  return last?.role === 'user'
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
  findLastUserText,
  forgetGoalPrompt,
  GOAL_BUDGET_OPTIONS,
  isAbortedRun,
  isUserInterjection,
  parseGoalProgress,
  readAssistantText,
  readGoalPrompt,
  readGoalRun,
  readNextGoalBudget,
  rememberGoalPrompt,
  subscribeGoalBudget,
  writeNextGoalBudget,
  setGoalProgress,
  startGoalRun,
  stopGoalRun,
  subscribeGoalRun,
  useGoalRun
}
export type { GoalObjective, GoalProgress, GoalRun }
