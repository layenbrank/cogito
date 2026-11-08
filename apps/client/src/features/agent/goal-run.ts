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
import { readAgentMode, readAgentModeFor, writeAgentModeFor } from '@/features/agent/mode'
import type { GoalRecord, GoalStatus } from '@/features/agent/plan-store'
import {
  bindGoalRecovery,
  listGoals,
  readGoal,
  saveGoal,
  subscribePlanStore
} from '@/features/agent/plan-store'
import type { AgentMode, ApprovalMode } from '@/features/persist'

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

/**
 * `GoalRun` 派生对象按**档案记录**缓存。
 *
 * `useGoalRun` 把它喂给 `useSyncExternalStore`，而快照必须是同一个引用：
 * 每次现造 `{...}` 会让 React 认为「快照一直在变」→ 无限重渲染，
 * 最终抛 `Maximum update depth exceeded`（React #185）把整页打进 ErrorBoundary。
 * 目标档案在 `plan-store` 里是不可变替换（`saveGoal` 建新对象再 `goals.set`），
 * 所以以记录为缓存键既稳定又自带失效。
 */
const runCache = new WeakMap<GoalRecord, GoalRun>()

function toGoalRun(threadID: string): GoalRun | null {
  const record = readGoal(threadID)
  if (!record) return null
  const cached = runCache.get(record)
  if (cached) return cached
  const run: GoalRun = {
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
  runCache.set(record, run)
  return run
}

/**
 * 同步读（`goal-auto-advance` 在流式回调里用，不能改成 async）。
 * `paused` / `done` 视为没有进行中的目标；`exhausted` 仍返回 —— UI 要显示
 * 「已用尽」以及实际跑了几轮。
 */
function readGoalRun(threadID: string): GoalRun | null {
  const run = toGoalRun(threadID.trim())
  if (!run) return null
  // `interrupted` 与 `paused` 一样是「没有在进行中的目标」：崩溃自愈把它写下来，
  // 拉起的只是历史记录，不能再驱动自动续跑。
  return run.status === 'paused' || run.status === 'done' || run.status === 'interrupted'
    ? null
    : run
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
 * 回合租约：一轮推进期间只有持租约的人能「收尾并决定下一步」。
 *
 * 为什么需要：composer 侧（`goal-auto-advance`）与后台侧（`goal-continue`）都挂在
 * 「一轮结束」上，互斥靠「查对方在不在跑」—— 查询不是锁：切线程瞬间两边都可能收到结束
 * 回调，同一轮会被推进两次（预算跳号、重复发送、重复写 goal 行）。租约把它变成一次 CAS：
 * 先进来的消费掉租约，后进来的看到「没有活租约」就放弃。
 *
 * 过期时间同时承担崩溃判定：`running` 却没有活租约 = 上一进程已经死了（启动自愈据此归一）。
 */
const TURN_LEASE_MS = 10 * 60 * 1000

function newRunID(): string {
  try {
    return crypto.randomUUID()
  } catch (error) {
    console.warn('[agent/goal] 生成 runID 失败，退化为时间戳:', error)
    return `run-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function isTurnLeaseLive(record: GoalRecord | null, now = Date.now()): boolean {
  if (!record) return false
  if (!record.leaseRunID || record.leaseUntil === null) return false
  return record.leaseUntil > now
}

/** 起一轮（首轮 / 续跑轮）：写租约并返回 runID */
function beginGoalTurn(threadID: string, ttl = TURN_LEASE_MS): string | null {
  const id = threadID.trim()
  if (!readGoal(id)) return null
  const runID = newRunID()
  saveGoal({ sessionID: id, leaseRunID: runID, leaseUntil: Date.now() + ttl })
  return runID
}

/** 续租：只有持租约的 runID 能续（CAS，别人的租约不动） */
function renewGoalTurn(threadID: string, runID: string, ttl = TURN_LEASE_MS): boolean {
  const id = threadID.trim()
  const record = readGoal(id)
  if (!record || record.leaseRunID !== runID) return false
  saveGoal({ sessionID: id, leaseUntil: Date.now() + ttl })
  return true
}

/** 每线程的推进代数：回调带着它进来，过期回调（切线程 / 重复结束）直接丢弃 */
const advanceGenerations = new Map<string, number>()

function readGoalGeneration(threadID: string): number {
  return advanceGenerations.get(threadID.trim()) ?? 0
}

/** 推进原因：只有 `continue` 会开下一轮，其余一律收敛到终态 */
type GoalAdvanceReason =
  | 'continue'
  | 'done'
  | 'aborted'
  | 'no-signal'
  | 'interjection'
  | 'typing'
  | 'plan-stale'
  | 'context-missing'

type GoalAdvanceOutcome =
  | { kind: 'dispatch'; prompt: string; run: GoalRun }
  | { kind: 'done' }
  | { kind: 'paused' }
  | { kind: 'exhausted' }
  | { kind: 'ignored' }

/**
 * **唯一**的推进入口：一轮结束时由 composer 侧或后台侧调进来。
 *
 * 幂等 / 单飞靠租约：拿到活租约的调用方才有权推进，并顺手把租约清掉；
 * 第二次调用（同一轮的另一条结束回调、切线程后的迟到回调、崩溃重启后的旧回调）
 * 看到的是「没有活租约」，直接返回 `ignored`，不会重复扣预算。
 */
function advanceGoal(
  threadID: string,
  reason: GoalAdvanceReason,
  generation = readGoalGeneration(threadID)
): GoalAdvanceOutcome {
  const id = threadID.trim()
  if (!id) return { kind: 'ignored' }
  const record = readGoal(id)
  if (!record || record.status !== 'running') return { kind: 'ignored' }
  if (generation !== readGoalGeneration(id)) return { kind: 'ignored' }
  if (!isTurnLeaseLive(record)) return { kind: 'ignored' }

  advanceGenerations.set(id, generation + 1)
  saveGoal({ sessionID: id, leaseRunID: null, leaseUntil: null })

  if (reason === 'done') {
    finishGoalRun(id, 'done')
    return { kind: 'done' }
  }
  if (reason !== 'continue') {
    finishGoalRun(id, 'paused')
    return { kind: 'paused' }
  }
  if (!advanceGoalRun(id)) return { kind: 'exhausted' }
  const next = readGoalRun(id)
  if (!next) return { kind: 'ignored' }
  const prompt = buildContinuePrompt(next)
  rememberGoalPrompt(id, prompt)
  // 新一轮的租约**由真正开跑的一方**建（`port/model` 与 `goal-continue.startGoalTurn`），
  // 不在这里建：这里建等于「刚消费完就立刻续上」，同一轮的第二个结束回调又会被当成合法推进。
  return { kind: 'dispatch', prompt, run: next }
}

/**
 * 启动自愈：`running` 却没有活租约的行 → `interrupted`，并还原审批档与模式。
 *
 * 幂等：已经归一过的行不再动。由 `plan-store` 的 `hydrate()` 通过注入点调用
 * （本模块依赖 plan-store，反过来 import 会成环）。
 */
function recoverInterruptedGoals(records: readonly GoalRecord[], now = Date.now()): number {
  let fixed = 0
  for (const record of records) {
    if (record.status !== 'running') continue
    if (isTurnLeaseLive(record, now)) continue
    saveGoal({
      sessionID: record.sessionID,
      status: 'interrupted',
      leaseRunID: null,
      leaseUntil: null
    })
    restoreGoalApproval(record.sessionID, record.approvalBefore)
    restoreGoalMode(record.sessionID, record.modeBefore)
    forgetGoalPrompt(record.sessionID)
    fixed += 1
  }
  return fixed
}

bindGoalRecovery(recoverInterruptedGoals)

/**
 * 本轮归属 prompt：热路径用内存，同时落库到 `expectedPrompt`，刷新后仍可判插话 / Resume。
 */
const expectedPromptCache = new Map<string, string>()

function rememberGoalPrompt(threadID: string, prompt: string): void {
  const id = threadID.trim()
  const text = prompt.trim()
  expectedPromptCache.set(id, text)
  saveGoal({ sessionID: id, expectedPrompt: text })
}

function forgetGoalPrompt(threadID: string): void {
  const id = threadID.trim()
  expectedPromptCache.delete(id)
  const record = readGoal(id)
  if (record?.expectedPrompt) {
    saveGoal({ sessionID: id, expectedPrompt: null })
  }
}

function readGoalPrompt(threadID: string): string | null {
  const id = threadID.trim()
  const cached = expectedPromptCache.get(id)
  if (cached) return cached
  const fromStore = readGoal(id)?.expectedPrompt?.trim()
  if (fromStore) {
    expectedPromptCache.set(id, fromStore)
    return fromStore
  }
  return null
}

/**
 * 目标推进要无人值守，工具一弹审批整轮就停在那儿等。
 * 返回是否真的改过档位（UI 据此提示用户）。
 */
/** 偏好落盘后推 goose；无 session 时静默（下次 ensure 会跟上） */
function pushThreadApproval(threadID: string, mode: ApprovalMode): void {
  void import('@/features/agent/acp/sync-thread-approval')
    .then(function (mod) {
      return mod.syncApprovalForThread(threadID, mode)
    })
    .catch(function (error: unknown) {
      console.warn('[agent/goal] 同步审批到 goose 失败:', error)
    })
}

function ensureGoalApproval(threadID: string): ApprovalMode | null {
  const current = readApprovalModeFor(threadID)
  if (current === 'auto') {
    // 已是 auto 也重推一次：避免 goose 仍停在 smart_approve
    pushThreadApproval(threadID, 'auto')
    return null
  }
  writeApprovalModeFor(threadID, 'auto')
  pushThreadApproval(threadID, 'auto')
  return current
}

/** 只恢复这个会话；用户中途自己改过就不动 —— “他说了算”更重要 */
function restoreGoalApproval(threadID: string, before: string | null): void {
  if (!before) return
  if (readApprovalModeFor(threadID) !== 'auto') return
  writeApprovalModeFor(threadID, before as ApprovalMode)
  pushThreadApproval(threadID, before as ApprovalMode)
}

/** 模式同理：只在还停在目标模式时还原，用户已经切走就不覆盖他的选择 */
function restoreGoalMode(threadID: string, before: string | null): void {
  if (!before || before === 'goal') return
  if (readAgentModeFor(threadID) !== 'goal') return
  void writeAgentModeFor(threadID, before as AgentMode).catch(function (error: unknown) {
    console.warn('[agent/goal] 还原会话模式失败:', error)
  })
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
  // 启动前用户所处的模式：收尾 / 崩溃自愈时据此还原（`approvalBefore` 的姊妹字段）
  const modeBefore = readAgentMode()
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
    approvalBefore: before,
    modeBefore,
    // 首轮也要拿租约：一轮结束时才有人能「收尾并决定下一步」
    leaseRunID: newRunID(),
    leaseUntil: Date.now() + TURN_LEASE_MS,
    expectedPrompt: prompt?.trim() || null
  })
  if (prompt) {
    expectedPromptCache.set(id, prompt.trim())
  } else {
    expectedPromptCache.delete(id)
  }
  return before !== null
}

/**
 * 从 paused / exhausted 继续推进：保留 objective 与 budget，重置 used，status→running。
 * 返回续跑用的 GoalRun；不可恢复时返回 null。
 */
function resumeGoalRun(threadID: string): GoalRun | null {
  const id = threadID.trim()
  const record = readGoal(id)
  if (!record) return null
  if (record.status !== 'paused' && record.status !== 'exhausted') return null
  const before = ensureGoalApproval(id)
  saveGoal({
    sessionID: id,
    used: 0,
    status: 'running',
    approvalBefore: before ?? record.approvalBefore,
    modeBefore: record.modeBefore ?? readAgentMode(),
    leaseRunID: newRunID(),
    leaseUntil: Date.now() + TURN_LEASE_MS,
    progressDone: null,
    progressTotal: null
  })
  return readGoalRun(id)
}

/** 目标收尾态：完成 / 预算用尽 / 用户或插话暂停 —— 三者互不覆盖 */
type GoalFinishStatus = 'done' | 'exhausted' | 'paused'

/**
 * 写入明确终态并恢复审批。
 *
 * - `done` / `exhausted` 是成功语义的终点，不能再被 `paused` 抹掉；
 * - 已是 `done` 时拒绝降级；已是 `exhausted` 时只允许保持 `exhausted`（幂等）。
 */
function finishGoalRun(threadID: string, status: GoalFinishStatus): void {
  const id = threadID.trim()
  if (!id) return
  const record = readGoal(id)
  if (!record) return
  if (record.status === 'done') return
  if (record.status === 'exhausted' && status === 'paused') return
  if (record.status === status) {
    // 幂等：用尽路径里 advance 已写 exhausted 并恢复审批，这里只清 prompt
    forgetGoalPrompt(id)
    return
  }
  saveGoal({ sessionID: id, status, leaseRunID: null, leaseUntil: null })
  restoreGoalApproval(id, record.approvalBefore)
  restoreGoalMode(id, record.modeBefore)
  forgetGoalPrompt(id)
}

/**
 * 用户/插话暂停；**不传** threadID 才是全停。
 *
 * 只动 `running` —— 不会把 `done` / `exhausted` 降成 `paused`。
 * `null` / 空串一律 no-op。
 */
function stopGoalRun(threadID?: string | null): void {
  if (threadID === null) return
  if (threadID === undefined) {
    for (const record of listGoals()) {
      if (record.status !== 'running') continue
      finishGoalRun(record.sessionID, 'paused')
    }
    return
  }
  const id = threadID.trim()
  if (!id) return
  const record = readGoal(id)
  if (!record || record.status !== 'running') return
  finishGoalRun(id, 'paused')
}

/**
 * 记一轮完成，返回是否还有预算继续。
 *
 * 首轮由「开始执行」直接发出，不经过这里 —— 所以本轮结束时先自增再判断。
 * 用尽时直接写 `exhausted` 并恢复审批；调用方不得再 `stopGoalRun` 覆盖。
 */
function advanceGoalRun(threadID: string): boolean {
  const id = threadID.trim()
  const record = readGoal(id)
  if (!record || record.status !== 'running') return false
  const used = record.used + 1
  const exhausted = used >= record.budget
  if (exhausted) {
    saveGoal({ sessionID: id, used, status: 'exhausted' })
    restoreGoalApproval(id, record.approvalBefore)
    forgetGoalPrompt(id)
    return false
  }
  saveGoal({ sessionID: id, used, status: 'running' })
  return true
}

/** 模型收尾标记：全部达成 / 仍需继续 */
// 段落级严格匹配：标记必须**独占一行**（允许行首标题 / 列表符号与行尾句号）。
// 旧写法只要求行首，于是正文里引一句「请输出 GOAL_CONTINUE 或 GOAL_DONE」就会误触发，
// 把还在推进的目标直接判成收尾。
const GOAL_DONE =
  /(^|\n)[ \t]*(?:#{1,6}[ \t]*|[-*+][ \t]*)?_*GOAL_DONE_*[ \t]*[。.!！]?[ \t]*(?=\n|$)/
const GOAL_CONTINUE =
  /(^|\n)[ \t]*(?:#{1,6}[ \t]*|[-*+][ \t]*)?_*GOAL_CONTINUE_*[ \t]*[。.!！]?[ \t]*(?=\n|$)/

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
/**
 * 摘掉 ``` / ~~~ 围栏块。
 *
 * 围栏里独占一行的 `GOAL_DONE` 多半是**在引用收尾约定**（把规则抄一遍），而归一化
 * 又会把反引号削掉 —— 不先摘掉围栏，它和正文结论看起来一模一样。
 * 围栏数量为奇数（模型少写一个 ```）时不动原文：宁可维持旧行为，也不能因为围栏
 * 没闭合就把真正的收尾标记一起吞掉。
 */
function stripFencedBlocks(text: string): string {
  const lines = text.split('\n')
  const fences = lines.filter(function (line) {
    return /^\s*(?:```|~~~)/.test(line)
  }).length
  if (fences % 2 !== 0) return text
  const kept: string[] = []
  let fenced = false
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (!fenced) kept.push(line)
  }
  return kept.join('\n')
}

function findGoalSignal(text: string): 'done' | 'continue' | null {
  // 顺序要紧：先摘围栏，再归一化（归一化会削掉反引号，之后就分不出围栏了）。
  const normalized = stripFencedBlocks(text).replace(/[`*~"']/g, '').toUpperCase()
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
  advanceGoal,
  advanceGoalRun,
  beginGoalTurn,
  buildContinuePrompt,
  DEFAULT_BUDGET,
  findGoalSignal,
  findLastAssistant,
  findLastUserText,
  finishGoalRun,
  forgetGoalPrompt,
  GOAL_BUDGET_OPTIONS,
  isAbortedRun,
  isUserInterjection,
  parseGoalProgress,
  readAssistantText,
  readGoalGeneration,
  readGoalPrompt,
  readGoalRun,
  recoverInterruptedGoals,
  renewGoalTurn,
  readNextGoalBudget,
  rememberGoalPrompt,
  subscribeGoalBudget,
  writeNextGoalBudget,
  setGoalProgress,
  resumeGoalRun,
  startGoalRun,
  stopGoalRun,
  subscribeGoalRun,
  useGoalRun
}
export type {
  GoalAdvanceOutcome,
  GoalAdvanceReason,
  GoalFinishStatus,
  GoalObjective,
  GoalProgress,
  GoalRun
}
