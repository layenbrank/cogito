/**
 * 计划 / 目标档案的本地仓储：**内存 cache 是同步真相，SQLite 是持久真相**。
 *
 * 为什么需要它：右栏计划原来由 `findPlanDraft()` 每次从「最后一条 assistant 正文」
 * 现算，任何后续问答都会让计划消失；目标推进的 `GoalRun` 与「审批恢复档」都放在
 * 模块级 Map 里，刷新即丢。这里把两者落成「一行一个会话」的档案：
 *
 * - 读：走 cache（`AppRuntime` 启动 / 切线程时 `hydrate`），同步返回，UI 不阻塞；
 * - 写：先改 cache 再 IPC 落库，400ms 防抖合并同一会话的连续写；
 * - 失败：回滚 cache 到上一次已落库的快照，并 `reportCaught`。
 *
 * 不变量：`body` 是唯一执行依据；`digest` 变化即「计划被改过」（`revision + 1`，
 * `running` 回落 `draft`；`done` / `interrupted` 归档成 `superseded`）；
 * `executedRevision` 记「上次执行的是第几版」，改版**不**清它 ——
 * `revision > executedRevision` 就是「计划已更新、上次跑的是旧版」（见 `isPlanStale`）；
 * 一个会话只允许一行（表上有 `sessionID` 唯一索引）。
 */
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useSyncExternalStore } from 'react'

import type { PlanDraft } from '@/features/agent/plan-draft'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

export type PlanStatus = 'draft' | 'running' | 'done' | 'interrupted' | 'superseded'
export type PlanSource = 'thread' | 'file'
export type GoalStatus = 'running' | 'paused' | 'done' | 'exhausted'

export interface PlanRecord {
  id: string
  /** 唯一索引：一个会话只有一份计划 */
  sessionID: string
  title: string
  overview: string
  /** 从 `steps` JSON 还原：只用于 UI 进度 */
  steps: string[]
  /** 计划正文全量：执行、渲染、保存都以它为准 */
  body: string
  status: PlanStatus
  source: PlanSource
  filePath: string | null
  revision: number
  /** 上次开始执行时的 revision；`null` = 还没执行过 */
  executedRevision: number | null
  /** 被哪一版取代（旧版执行在改版时归档）；`null` = 没被取代过 */
  supersededBy: number | null
  digest: string
  truncated: boolean
  createdAt: number
  updatedAt: number
  executedAt: number | null
  finishedAt: number | null
}

export interface GoalRecord {
  id: string
  sessionID: string
  /** ≤120 字摘要：横幅 / 页签用 */
  summary: string
  /** 用户原始 prompt：续跑指令用 */
  detail: string
  budget: number
  used: number
  progressDone: number | null
  progressTotal: number | null
  status: GoalStatus
  /** 启动前被改掉的审批档，结束后据此还原 */
  approvalBefore: string | null
  /** 最近一轮自动续跑的 user prompt；刷新后仍可判插话 */
  expectedPrompt: string | null
  createdAt: number
  updatedAt: number
}

/** 同一会话连续写合并窗口：400ms 足够把「状态 + 进度 + 时间戳」并成一次 IPC */
const FLUSH_DELAY = 400

interface PlanRow {
  id: string
  sessionID: string
  title: string
  overview: string
  steps: string
  body: string
  status: string
  source: string
  filePath: string | null
  revision: number
  executedRevision: number | null
  supersededBy: number | null
  digest: string
  truncated: boolean
  createdAt: number
  updatedAt: number
  executedAt: number | null
  finishedAt: number | null
}

interface GoalRow {
  id: string
  sessionID: string
  summary: string
  detail: string
  budget: number
  used: number
  progressDone: number | null
  progressTotal: number | null
  status: string
  approvalBefore: string | null
  expectedPrompt: string | null
  createdAt: number
  updatedAt: number
}

const plans = new Map<string, PlanRecord>()
const goals = new Map<string, GoalRecord>()
/** 上一次确认已落库的快照：IPC 失败时回滚到它 */
const persistedPlans = new Map<string, PlanRecord>()
const persistedGoals = new Map<string, GoalRecord>()

const pendingPlans = new Map<string, 'write' | 'remove'>()
const pendingGoals = new Map<string, 'write' | 'remove'>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

function subscribePlanStore(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

/** 桌面壳外（浏览器预览 / 单测）没有 IPC：只维护 cache，不落库 */
function canPersist(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  )
}

function parseSteps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(function (item) {
        return typeof item === 'string' ? item : ''
      })
      .filter(function (item) {
        return item.length > 0
      })
  } catch (error) {
    console.warn('[agent/plan-store] steps 不是合法 JSON，按空清单处理:', error)
    return []
  }
}

function toPlanStatus(value: string): PlanStatus {
  switch (value) {
    case 'running':
    case 'done':
    case 'interrupted':
    case 'superseded':
      return value
    default:
      return 'draft'
  }
}

function toGoalStatus(value: string): GoalStatus {
  switch (value) {
    case 'paused':
    case 'done':
    case 'exhausted':
      return value
    default:
      return 'running'
  }
}

function toPlanRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    sessionID: row.sessionID,
    title: row.title,
    overview: row.overview,
    steps: parseSteps(row.steps),
    body: row.body,
    status: toPlanStatus(row.status),
    source: row.source === 'file' ? 'file' : 'thread',
    filePath: row.filePath,
    revision: row.revision,
    executedRevision: row.executedRevision ?? null,
    supersededBy: row.supersededBy ?? null,
    digest: row.digest,
    truncated: row.truncated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    executedAt: row.executedAt,
    finishedAt: row.finishedAt
  }
}

function toGoalRecord(row: GoalRow): GoalRecord {
  return {
    id: row.id,
    sessionID: row.sessionID,
    summary: row.summary,
    detail: row.detail,
    budget: row.budget,
    used: row.used,
    progressDone: row.progressDone,
    progressTotal: row.progressTotal,
    status: toGoalStatus(row.status),
    approvalBefore: row.approvalBefore,
    expectedPrompt: row.expectedPrompt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function schedulePlan(threadID: string, op: 'write' | 'remove'): void {
  pendingPlans.set(threadID, op)
  scheduleFlush()
}

function scheduleGoal(threadID: string, op: 'write' | 'remove'): void {
  pendingGoals.set(threadID, op)
  scheduleFlush()
}

function scheduleFlush(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(function () {
    flushTimer = null
    void flush()
  }, FLUSH_DELAY)
}

/** 立即把所有待写项落库（测试 / 关闭前排空用） */
async function flush(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  const planWork = [...pendingPlans]
  const goalWork = [...pendingGoals]
  pendingPlans.clear()
  pendingGoals.clear()
  await Promise.all([
    ...planWork.map(function ([threadID, op]) {
      return persistPlan(threadID, op)
    }),
    ...goalWork.map(function ([threadID, op]) {
      return persistGoal(threadID, op)
    })
  ])
}

async function persistPlan(threadID: string, op: 'write' | 'remove'): Promise<void> {
  if (!canPersist()) return
  try {
    if (op === 'remove') {
      await invoke<string[]>(CHANNELS.AGENT_PLAN.TO_REMOVE, { params: [threadID] })
      persistedPlans.delete(threadID)
      return
    }
    const record = plans.get(threadID)
    if (!record) return
    await invoke<string[]>(CHANNELS.AGENT_PLAN.TO_WRITE, {
      params: { ...record, steps: JSON.stringify(record.steps) }
    })
    persistedPlans.set(threadID, record)
  } catch (error) {
    reportCaught('agent-plan-store.persistPlan', error)
    rollbackPlan(threadID)
  }
}

async function persistGoal(threadID: string, op: 'write' | 'remove'): Promise<void> {
  if (!canPersist()) return
  try {
    if (op === 'remove') {
      await invoke<string[]>(CHANNELS.AGENT_GOAL.TO_REMOVE, { params: [threadID] })
      persistedGoals.delete(threadID)
      return
    }
    const record = goals.get(threadID)
    if (!record) return
    await invoke<string[]>(CHANNELS.AGENT_GOAL.TO_WRITE, { params: record })
    persistedGoals.set(threadID, record)
  } catch (error) {
    reportCaught('agent-plan-store.persistGoal', error)
    rollbackGoal(threadID)
  }
}

function rollbackPlan(threadID: string): void {
  const previous = persistedPlans.get(threadID)
  if (previous) plans.set(threadID, previous)
  else plans.delete(threadID)
  notify()
}

function rollbackGoal(threadID: string): void {
  const previous = persistedGoals.get(threadID)
  if (previous) goals.set(threadID, previous)
  else goals.delete(threadID)
  notify()
}

/**
 * 把库里的档案灌进 cache。
 * 启动时读全量（一次 IPC）；切线程时只读该会话。
 */
async function hydrate(threadIDs?: readonly string[]): Promise<void> {
  if (!canPersist()) return
  const planParams = threadIDs?.length
    ? threadIDs.map(function (id) {
        return { sessionID: id, includeBody: true }
      })
    : { includeBody: true }
  const goalParams = threadIDs?.length
    ? threadIDs.map(function (id) {
        return { sessionID: id }
      })
    : {}
  try {
    const [planRows, goalRows] = await Promise.all([
      invoke<PlanRow[]>(CHANNELS.AGENT_PLAN.TO_READ, { params: planParams }),
      invoke<GoalRow[]>(CHANNELS.AGENT_GOAL.TO_READ, { params: goalParams })
    ])
    for (const row of planRows) {
      // 本地还有没落库的改动时以本地为准，避免 hydrate 把用户刚做的事抹掉
      if (pendingPlans.has(row.sessionID)) continue
      const record = toPlanRecord(row)
      plans.set(record.sessionID, record)
      persistedPlans.set(record.sessionID, record)
    }
    for (const row of goalRows) {
      if (pendingGoals.has(row.sessionID)) continue
      const record = toGoalRecord(row)
      goals.set(record.sessionID, record)
      persistedGoals.set(record.sessionID, record)
    }
    notify()
  } catch (error) {
    reportCaught('agent-plan-store.hydrate', error)
  }
}

function readPlan(threadID: string | null | undefined): PlanRecord | null {
  const id = threadID?.trim()
  if (!id) return null
  return plans.get(id) ?? null
}

function readGoal(threadID: string | null | undefined): GoalRecord | null {
  const id = threadID?.trim()
  if (!id) return null
  return goals.get(id) ?? null
}

function digestPlan(body: string): string {
  // djb2：只用来判断「内容变没变」，不需要抗碰撞
  let hash = 5381
  for (let index = 0; index < body.length; index += 1) {
    hash = ((hash << 5) + hash) ^ body.charCodeAt(index)
  }
  return (hash >>> 0).toString(16)
}

interface SavePlanInput extends Partial<Omit<PlanDraft, 'steps'>> {
  sessionID: string
  steps?: readonly string[]
  status?: PlanStatus
  source?: PlanSource
  filePath?: string | null
  digest?: string
  truncated?: boolean
  revision?: number
  executedRevision?: number | null
  supersededBy?: number | null
  executedAt?: number | null
  finishedAt?: number | null
}

function savePlan(input: SavePlanInput): PlanRecord {
  const now = Date.now()
  const previous = plans.get(input.sessionID)
  const body = input.body ?? previous?.body ?? ''
  const record: PlanRecord = {
    id: previous?.id ?? crypto.randomUUID(),
    sessionID: input.sessionID,
    title: input.title ?? previous?.title ?? '',
    overview: input.overview ?? previous?.overview ?? '',
    steps: input.steps ? [...input.steps] : (previous?.steps ?? []),
    body,
    status: input.status ?? previous?.status ?? 'draft',
    source: input.source ?? previous?.source ?? 'thread',
    filePath: input.filePath === undefined ? (previous?.filePath ?? null) : input.filePath,
    revision: input.revision ?? previous?.revision ?? 1,
    executedRevision:
      input.executedRevision === undefined
        ? (previous?.executedRevision ?? null)
        : input.executedRevision,
    supersededBy:
      input.supersededBy === undefined ? (previous?.supersededBy ?? null) : input.supersededBy,
    digest: input.digest ?? previous?.digest ?? digestPlan(body),
    truncated: input.truncated ?? previous?.truncated ?? false,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    executedAt: input.executedAt === undefined ? (previous?.executedAt ?? null) : input.executedAt,
    finishedAt: input.finishedAt === undefined ? (previous?.finishedAt ?? null) : input.finishedAt
  }
  plans.set(record.sessionID, record)
  schedulePlan(record.sessionID, 'write')
  notify()
  return record
}

/**
 * 状态机推进：`draft → running → done / interrupted`。
 *
 * `running` 时记 `executedAt` **并锁住这一版**（`executedRevision = revision`）——
 * 这是「这一轮到底跑的是第几版」的唯一记录：改版不会清它，于是
 * `revision > executedRevision` 就能判出「计划改过了、上次执行基于旧版」。
 * `done` 时记 `finishedAt`。
 */
function setPlanStatus(threadID: string, status: PlanStatus): PlanRecord | null {
  const record = readPlan(threadID)
  if (!record) return null
  const now = Date.now()
  const next: PlanRecord = {
    ...record,
    status,
    updatedAt: now,
    // 重新开始执行 = 认可当前 revision：`superseded` 同时解除，否则会卡在归档态
    executedRevision: status === 'running' ? record.revision : record.executedRevision,
    supersededBy: status === 'running' ? null : record.supersededBy,
    executedAt: status === 'running' ? now : record.executedAt,
    finishedAt: status === 'done' ? now : record.finishedAt
  }
  plans.set(next.sessionID, next)
  schedulePlan(next.sessionID, 'write')
  notify()
  return next
}

/**
 * 正文/文件变了：`revision + 1`。
 *
 * - `running` → 回落 `draft`（这份计划已经对不上正在跑的东西了）；
 * - `done` / `interrupted` → 归档成 `superseded`，并记 `supersededBy = 新 revision`。
 *   以前这里是「保持 done，只多显示一个已过期」，结果上一份跑过的计划既没被标成
 *   过期、也不拦重复执行 —— 用户一点「开始执行」就又跑一遍旧计划（白烧 token）；
 * - `executedRevision` 一律**不动**：它记的是「上次执行的是第几版」，不是当前版本。
 */
function bumpRevision(
  threadID: string,
  digest: string,
  patch?: Pick<SavePlanInput, 'title' | 'overview' | 'steps' | 'body' | 'truncated'>
): boolean {
  const record = readPlan(threadID)
  if (!record || record.digest === digest) return false
  const now = Date.now()
  const body = patch?.body ?? record.body
  const nextRevision = record.revision + 1
  // 跑过的版本（done / interrupted / 已归档）在改版时归档；草稿与正在跑的只回落 draft
  const keepRunning = record.status === 'running' || record.status === 'draft'
  const nextStatus: PlanStatus = keepRunning ? 'draft' : 'superseded'
  const next: PlanRecord = {
    ...record,
    title: patch?.title ?? record.title,
    overview: patch?.overview ?? record.overview,
    steps: patch?.steps ? [...patch.steps] : record.steps,
    body,
    truncated: patch?.truncated ?? record.truncated,
    digest,
    revision: nextRevision,
    status: nextStatus,
    supersededBy: keepRunning ? record.supersededBy : nextRevision,
    updatedAt: now
  }
  plans.set(next.sessionID, next)
  schedulePlan(next.sessionID, 'write')
  notify()
  return true
}

/**
 * 「上次执行基于旧版」的派生判据：`revision > executedRevision`。
 *
 * - 从没执行过（`executedAt` 与 `executedRevision` 都为空）→ 不算 stale：还没跑过的
 *   草稿不该显示「按新计划执行」；
 * - 老库里的行只有 `executedAt`、没有 `executedRevision`（本字段是后加的）→ 按 0 计，
 *   这样一次改版就会被判成 stale，而不是永远显示「没更新」。
 */
function isPlanStale(record: PlanRecord | null | undefined): boolean {
  if (!record) return false
  if (record.executedRevision === null && record.executedAt === null) return false
  return record.revision > (record.executedRevision ?? 0)
}

interface SaveGoalInput {
  sessionID: string
  summary?: string
  detail?: string
  budget?: number
  used?: number
  progressDone?: number | null
  progressTotal?: number | null
  status?: GoalStatus
  approvalBefore?: string | null
  expectedPrompt?: string | null
}

function saveGoal(input: SaveGoalInput): GoalRecord {
  const now = Date.now()
  const previous = readGoal(input.sessionID)
  const record: GoalRecord = {
    id: previous?.id ?? crypto.randomUUID(),
    sessionID: input.sessionID,
    summary: input.summary ?? previous?.summary ?? '',
    detail: input.detail ?? previous?.detail ?? '',
    budget: Math.max(1, input.budget ?? previous?.budget ?? 6),
    used: Math.max(0, input.used ?? previous?.used ?? 0),
    progressDone:
      input.progressDone === undefined ? (previous?.progressDone ?? null) : input.progressDone,
    progressTotal:
      input.progressTotal === undefined ? (previous?.progressTotal ?? null) : input.progressTotal,
    status: input.status ?? previous?.status ?? 'running',
    approvalBefore:
      input.approvalBefore === undefined
        ? (previous?.approvalBefore ?? null)
        : input.approvalBefore,
    expectedPrompt:
      input.expectedPrompt === undefined
        ? (previous?.expectedPrompt ?? null)
        : input.expectedPrompt,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  }
  goals.set(record.sessionID, record)
  scheduleGoal(record.sessionID, 'write')
  notify()
  return record
}

/** 删会话时一并清掉档案，不留孤儿行（表上没有外键，只能显式删） */
function removePlan(threadID: string): void {
  const id = threadID.trim()
  if (!id) return
  plans.delete(id)
  schedulePlan(id, 'remove')
  notify()
}

function removeGoal(threadID: string): void {
  const id = threadID.trim()
  if (!id) return
  goals.delete(id)
  scheduleGoal(id, 'remove')
  notify()
}

/** 供 `useSyncExternalStore`：右栏 / 详情页按会话读档案 */
function usePlanRecord(threadID: string | null | undefined): PlanRecord | null {
  const read = useCallback(
    function () {
      return readPlan(threadID)
    },
    [threadID]
  )
  return useSyncExternalStore(subscribePlanStore, read, read)
}

function useGoalRecord(threadID: string | null | undefined): GoalRecord | null {
  const read = useCallback(
    function () {
      return readGoal(threadID)
    },
    [threadID]
  )
  return useSyncExternalStore(subscribePlanStore, read, read)
}

/** 全量目标档案：`stopGoalRun()` 不传参数时据此收尾所有进行中的目标 */
function listGoals(): GoalRecord[] {
  return [...goals.values()]
}

/** 只给测试用：清空 cache、待写队列与定时器 */
function resetPlanStore(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  plans.clear()
  goals.clear()
  persistedPlans.clear()
  persistedGoals.clear()
  pendingPlans.clear()
  pendingGoals.clear()
}

export {
  bumpRevision,
  digestPlan,
  flush,
  hydrate,
  isPlanStale,
  listGoals,
  readGoal,
  readPlan,
  removeGoal,
  removePlan,
  resetPlanStore,
  saveGoal,
  savePlan,
  setPlanStatus,
  subscribePlanStore,
  useGoalRecord,
  usePlanRecord
}
export type { SaveGoalInput, SavePlanInput }
