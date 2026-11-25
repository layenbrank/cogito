/**
 * 计划执行的状态机：把「开始执行 → 观察这一轮 → 写终态」从组件里搬出来。
 *
 * ## 为什么必须搬出来（F-017）
 *
 * 这段逻辑原先分散在 `aside.tsx`（点按钮时 `setPlanStatus('running')` 再 `send()`）与
 * `plan-run-finish.tsx`（看到「最后一条助手消息」就写 done）。两个真问题：
 *
 * 1. **立即 done**：`running` 是在 `send()` 之前写的，而观察器此刻看到的「最后一条助手
 *    消息」还是上一轮那条（计划正文）。于是刚点执行、一个 token 都没出，计划就被标成 done。
 * 2. **静默失败**：`composer.send()` 在 `!canSend` 时**不抛错也不发**。状态已经写成
 *    `running` 的话，计划会永远停在「执行中」，而根本没有一轮在跑。
 *
 * 所以这里做三件事：**先发出去、发成功才置 running**（发送失败连同目标记录一起回滚）、
 * 记住开始那一刻的尾部消息 id（观察器只认之后出现的），以及**单飞**（重复点击第二个直接被拒）。
 */

import { setPlanStatus } from './plan-store'
import type { PlanStatus } from './plan-store'

type PlanTarget = 'agent' | 'goal'

type PlanFinishOutcome = Extract<PlanStatus, 'done' | 'interrupted'>

interface PlanExecutionState {
  threadID: string
  target: PlanTarget
  /** 开始那一刻的最后一条助手消息 id：观察器只认**之后**出现的（否则就是上一轮的收尾） */
  baselineTailID: string | null
  /** 已经结案的那条 tail：同一个 tail 只结一次（观察器会因订阅重放反复触发） */
  settledTailID: string | null
  /** 已占位但还没发出去：这段窗口里再点一次要被拒 */
  pending: boolean
}

interface BeginPlanExecutionInput {
  threadID: string
  target: PlanTarget
  /** 发送**之前**读到的最后一条助手消息 id */
  baselineTailID: string | null
  /**
   * 发送前的准备：切模式（必须先落盘，否则这一轮仍按计划档的只读发出去）、
   * 建/停目标记录。抛错则整条开始动作失败。
   */
  prepare: () => Promise<void>
  /**
   * 发送失败后的回滚（例如把刚建的目标记录收成 paused）。
   * 准备阶段已经改了外部状态，失败时必须还原，否则会留下「目标 running 但没有一轮在跑」。
   */
  rollback?: () => void
  /** 真正把 prompt 发出去。返回**是否真的发出**（`send()` 静默无效时是 false） */
  send: () => boolean | Promise<boolean>
}

type BeginPlanExecutionOutcome =
  | { ok: true }
  /** `busy`：这一线程已有一轮计划在执行；`not-sent`：发送被闸门拦下 */
  | { ok: false; reason: 'busy' | 'not-sent' }

/** 进行中的计划执行（按 thread 单飞）；非 React 状态，组件卸载不影响 */
const executing = new Map<string, PlanExecutionState>()

/** 可注入的档位写入口：单测不需要真库 */
let writeStatus: (threadID: string, status: PlanStatus) => void = setPlanStatus

function setPlanStatusWriter(writer: (threadID: string, status: PlanStatus) => void): void {
  writeStatus = writer
}

function isPlanExecutionActive(threadID: string): boolean {
  return executing.has(threadID.trim())
}

/**
 * 开始执行一份计划。
 *
 * 顺序是刻意的：**先 prepare → 再 send → 发出去了才置 running**。
 * 反过来的话，`send()` 被闸门拦下时会留下一个永远「执行中」的计划。
 */
async function beginPlanExecution(input: BeginPlanExecutionInput): Promise<BeginPlanExecutionOutcome> {
  const threadID = input.threadID.trim()
  if (!threadID) return { ok: false, reason: 'not-sent' }
  if (executing.has(threadID)) return { ok: false, reason: 'busy' }

  // 先占位再 await：同一 tick 的第二次点击也必须在 prepare 完成前被拒
  const state: PlanExecutionState = {
    threadID,
    target: input.target,
    baselineTailID: input.baselineTailID,
    settledTailID: null,
    pending: true
  }
  executing.set(threadID, state)

  function abort(): void {
    if (executing.get(threadID) === state) executing.delete(threadID)
  }

  try {
    await input.prepare()
  } catch (error) {
    abort()
    input.rollback?.()
    throw error
  }

  let sent = false
  try {
    sent = await input.send()
  } catch (error) {
    abort()
    input.rollback?.()
    throw error
  }
  if (!sent) {
    abort()
    input.rollback?.()
    return { ok: false, reason: 'not-sent' }
  }

  state.pending = false
  writeStatus(threadID, 'running')
  return { ok: true }
}

/**
 * 观察器报告「这一轮收尾了」。
 *
 * 返回 `true` 表示这次调用真的写了终态；`false` 表示被忽略（没在执行 / 还是上一轮的尾部 /
 * 同一个尾部已经结过案）。**幂等**：订阅重放、digest 反复触发都不会二次写。
 */
function finishPlanExecution(
  threadID: string,
  tailID: string | null,
  outcome: PlanFinishOutcome,
  options?: { force?: boolean }
): boolean {
  const key = threadID.trim()
  const state = executing.get(key)
  if (!state) return false

  if (!options?.force) {
    // 尾部没变 = 看到的还是开始之前那条消息（「立即 done」的根因），不能据此结案
    if (!tailID || tailID === state.baselineTailID) return false
    if (state.settledTailID === tailID) return false
    state.settledTailID = tailID
  }

  executing.delete(key)
  writeStatus(key, outcome)
  return true
}

/** 测试 / 清理：丢掉全部登记（不写档位） */
function clearPlanExecutions(): void {
  executing.clear()
}

export { beginPlanExecution, clearPlanExecutions, finishPlanExecution, isPlanExecutionActive, setPlanStatusWriter }
export type { BeginPlanExecutionInput, BeginPlanExecutionOutcome, PlanFinishOutcome, PlanTarget }
