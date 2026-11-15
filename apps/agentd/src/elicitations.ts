/**
 * 结构化追问闸门（agentd 侧）：goose 的 `elicitation/create` 在这里挂住，等前端回执。
 *
 * ## 为什么和 `approvals.ts` 分开而不是合并
 *
 * 两者机制同构（挂住 ACP 回包、按 requestId 回执、有超时、线程结束兜底），但**语义不同**：
 *
 * | | 审批 | 追问 |
 * | --- | --- | --- |
 * | 默认结局（fail-closed） | `cancelled`（不执行那个工具） | `decline`（放弃这次追问，让模型自己想办法） |
 * | 回执形状 | `{ outcome: { outcome, optionId } }` | `{ action, content? }` |
 *
 * 合并会把「两种默认值」塞进同一个 `settle(id, …)` 签名里，每个调用点都要先想「这是哪种」。
 * 重复的只是 60 行 waiters 样板，不是业务判断 —— 所以宁可重复。
 *
 * ## 与审批一致的约定
 *
 * - **未注册处理器 = 一律 decline**：没人在听时不要让 goose 一直等；
 * - 超时 `ELICITATION_TIMEOUT_MS` 到了按 `cancel` 结案（与 UI 的「取消」同义）；
 * - 进程退出 / 线程结束必须把等待者全部结掉，否则 `session/prompt` 永不返回。
 */

import { randomUUID } from 'node:crypto'

/** 追问最多等 5 分钟：与审批票据同值，超过就没人会回来填表了 */
export const ELICITATION_TIMEOUT_MS = 300_000

/** goose 的 `elicitation/create` 只支持 form 模式；url 模式上游尚未提供 */
interface ElicitationPayload {
  mode: 'form' | 'url'
  message: string
  /** JSON Schema（form 模式必填） */
  requestedSchema: unknown
  url?: string
}

interface ElicitationRequest extends ElicitationPayload {
  requestId: string
  threadID: string
  sessionId: string
  createdAt: number
}

/** 回执形状对齐 ACP：`accept` 带 `content`，`decline` / `cancel` 不带。 */
type ElicitationDecision =
  | { action: 'accept'; content?: Record<string, unknown> }
  | { action: 'decline' }
  | { action: 'cancel' }

interface ElicitationAskInput extends ElicitationPayload {
  threadID: string
  sessionId: string
}

interface ElicitationEvent {
  type: 'elicitation_requested' | 'elicitation_settled'
  elicitation: ElicitationRequest
  /** `settled` 时给出回执 */
  decision?: ElicitationDecision
}

interface ElicitationHub {
  ask(input: ElicitationAskInput): Promise<ElicitationDecision>
  settle(requestId: string, decision: ElicitationDecision): boolean
  pending(threadID?: string): ElicitationRequest[]
  subscribe(listener: (event: ElicitationEvent) => void): () => void
  /** 线程被取消/结束时兜底 */
  cancelThread(threadID: string): void
  cancelAll(): void
}

interface Waiter {
  request: ElicitationRequest
  resolve: (decision: ElicitationDecision) => void
  timer: ReturnType<typeof setTimeout>
}

function createElicitationHub(): ElicitationHub {
  const waiters = new Map<string, Waiter>()
  const listeners = new Set<(event: ElicitationEvent) => void>()

  function publish(event: ElicitationEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // 订阅者自己的问题不该影响追问流程
      }
    }
  }

  function settle(requestId: string, decision: ElicitationDecision): boolean {
    const waiter = waiters.get(requestId)
    if (!waiter) return false
    waiters.delete(requestId)
    clearTimeout(waiter.timer)
    publish({ type: 'elicitation_settled', elicitation: waiter.request, decision })
    waiter.resolve(decision)
    return true
  }

  function ask(input: ElicitationAskInput): Promise<ElicitationDecision> {
    const request: ElicitationRequest = {
      requestId: randomUUID(),
      threadID: input.threadID,
      sessionId: input.sessionId,
      mode: input.mode,
      message: input.message,
      requestedSchema: input.requestedSchema,
      ...(input.url ? { url: input.url } : {}),
      createdAt: Date.now()
    }
    return new Promise<ElicitationDecision>(function (resolve) {
      const timer = setTimeout(function () {
        // 无人回执时按 cancel 结案：与 UI 里点「取消」同义，goose 会当作「用户不填」
        settle(request.requestId, { action: 'cancel' })
      }, ELICITATION_TIMEOUT_MS)
      timer.unref?.()
      waiters.set(request.requestId, { request, resolve, timer })
      publish({ type: 'elicitation_requested', elicitation: request })
    })
  }

  function pending(threadID?: string): ElicitationRequest[] {
    const all: ElicitationRequest[] = []
    for (const waiter of waiters.values()) {
      if (threadID === undefined || waiter.request.threadID === threadID) {
        all.push(waiter.request)
      }
    }
    return all.sort(function (a, b) {
      return a.createdAt - b.createdAt
    })
  }

  function cancelThread(threadID: string): void {
    for (const request of pending(threadID)) {
      settle(request.requestId, { action: 'cancel' })
    }
  }

  function cancelAll(): void {
    for (const request of pending()) {
      settle(request.requestId, { action: 'cancel' })
    }
  }

  function subscribe(listener: (event: ElicitationEvent) => void): () => void {
    listeners.add(listener)
    return function () {
      listeners.delete(listener)
    }
  }

  return { ask, settle, pending, subscribe, cancelThread, cancelAll }
}

export { createElicitationHub }
export type {
  ElicitationAskInput,
  ElicitationDecision,
  ElicitationEvent,
  ElicitationHub,
  ElicitationPayload,
  ElicitationRequest
}
