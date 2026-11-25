/**
 * 工具审批闸门（agentd 侧）。
 *
 * ## 为什么不用 LangGraph 的 `interrupt()`
 *
 * 审批请求来自 goose 的 `session/request_permission` —— 它是在 `session/prompt` **还没返回**
 * 的时候从 goose 推上来的，而 `interrupt()` 会把当前节点整个打断、丢掉那次 `await`。
 * 一旦被打断，resume 后无法「回到原来那个 await」，只能重发 prompt —— 等于把已经算了一半
 * 的回合丢掉。所以这里的做法是 **挂住 ACP 回包**：prompt 一直等，等我们拿到用户的决定再写回。
 *
 * ## 语义
 *
 * - 无人认领（没订阅者 / 没有回执）→ 由调用方 `resolve(…, null)` 成 `cancelled`（fail-closed）；
 * - **超时也是 fail-closed**：`APPROVAL_TIMEOUT_MS` 到了没人回执，按取消结案。旧链路在渲染侧有
 *   `TICKET_TIMEOUT_MS = 300_000`，闸门搬到 agentd 后必须保留同一个值 —— 否则一个忘掉的审批
 *   会把这个线程的 ACP 回包永久悬住，而 UI 那边看起来只是「卡住了」。
 * - 判定规则本身不在这里：
 *   - 「哪些工具永远不许跑」（黑盒 shell / goose 原厂写工具）在
 *     `@cogito/agent-protocol/policy` 的 `findHardDenyLevel`；
 *   - 「这次调用该不该问用户」（只读档拒写、目标模式放行）在客户端的 `decideApproval`。
 *   本模块只负责转发 `optionId`，并在没人认领时按取消结案。
 * - 进程退出时会把所有等待者拒掉，避免 HTTP 侧永远挂起。
 */

import { randomUUID } from 'node:crypto'

import type { GateStore } from './gate-store'
import type { PermissionChoice, PermissionDecision } from './goose/client'

/** 与旧渲染侧 `TICKET_TIMEOUT_MS` 对齐：审批最多等 5 分钟 */
export const APPROVAL_TIMEOUT_MS = 300_000

interface ApprovalRequest {
  requestId: string
  threadID: string
  sessionId: string
  toolCall: unknown
  options: PermissionChoice[]
  createdAt: number
}

interface ApprovalEvent {
  type: 'approval_requested' | 'approval_settled'
  approval: ApprovalRequest
  /** `settled` 时给出结论：optionId 或 null（取消） */
  optionId?: string | null
}

interface ApprovalAskInput {
  threadID: string
  sessionId: string
  toolCall: unknown
  options: PermissionChoice[]
}

interface ApprovalHub {
  ask(input: ApprovalAskInput): Promise<PermissionDecision>
  /** 用户回执；`optionId=null` 表示拒绝/取消。返回 false 表示这条已经结案或不存在。 */
  settle(requestId: string, optionId: string | null): boolean
  /**
   * HTTP 回执专用：校验票据属于该 thread、optionId 在可选集合内，再幂等结案。
   * 不返回具体原因（防止跨线程探测），只给 ok / not_found / invalid_option。
   */
  settleFor(
    threadID: string,
    requestId: string,
    optionId: string | null
  ): 'ok' | 'not_found' | 'invalid_option'
  pending(threadID?: string): ApprovalRequest[]
  pendingOf(sessionId: string): ApprovalRequest | undefined
  subscribe(listener: (event: ApprovalEvent) => void): () => void
  /** 线程被取消/结束时兜底：把它的等待者全部按取消结掉 */
  cancelThread(threadID: string): void
  cancelAll(): void
}

interface Waiter {
  request: ApprovalRequest
  resolve: (decision: PermissionDecision) => void
  /** 超时兵。结案时必须清掉，否则定时器把人吊住、进程退不了 */
  timer: ReturnType<typeof setTimeout>
}

function createApprovalHub(options?: { onTimeout?: () => void; store?: GateStore | null }): ApprovalHub {
  const waiters = new Map<string, Waiter>()
  const listeners = new Set<(event: ApprovalEvent) => void>()
  const store = options?.store ?? null

  function publish(event: ApprovalEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // 订阅者自己的问题不该影响审批流程
      }
    }
  }

  function persist(request: ApprovalRequest): void {
    try {
      store?.insert({
        requestId: request.requestId,
        kind: 'approval',
        threadID: request.threadID,
        sessionId: request.sessionId,
        payload: { toolCall: request.toolCall, options: request.options },
        createdAt: request.createdAt,
        expiresAt: request.createdAt + APPROVAL_TIMEOUT_MS
      })
    } catch {
      // 持久化失败不影响当前进程的审批：内存 waiter 仍是真相
    }
  }

  function finish(
    requestId: string,
    optionId: string | null,
    state: 'settled' | 'expired' | 'cancelled'
  ): boolean {
    const waiter = waiters.get(requestId)
    if (!waiter) return false
    waiters.delete(requestId)
    clearTimeout(waiter.timer)
    try {
      store?.settle(requestId, state, optionId)
    } catch {
      // 同上：结案以内存为准
    }
    publish({
      type: 'approval_settled',
      approval: waiter.request,
      optionId
    })
    waiter.resolve(optionId === null ? null : { optionId })
    return true
  }

  function settle(requestId: string, optionId: string | null): boolean {
    return finish(requestId, optionId, 'settled')
  }

  function settleFor(
    threadID: string,
    requestId: string,
    optionId: string | null
  ): 'ok' | 'not_found' | 'invalid_option' {
    const waiter = waiters.get(requestId)
    // 票据不属于该 thread 时按 not_found 处理：不回「存在但越权」，避免探测
    if (!waiter || waiter.request.threadID !== threadID) return 'not_found'
    if (
      optionId !== null &&
      !waiter.request.options.some(function (option) {
        return option.optionId === optionId
      })
    ) {
      return 'invalid_option'
    }
    finish(requestId, optionId, 'settled')
    return 'ok'
  }

  function ask(input: ApprovalAskInput): Promise<PermissionDecision> {
    const request: ApprovalRequest = {
      requestId: randomUUID(),
      threadID: input.threadID,
      sessionId: input.sessionId,
      toolCall: input.toolCall,
      options: input.options,
      createdAt: Date.now()
    }
    return new Promise<PermissionDecision>(function (resolve) {
      const timer = setTimeout(function () {
        // 先告诉外部「这是超时」再结案：只靠 optionId=null 分不出「用户拒绝」与「没人理」
        options?.onTimeout?.()
        finish(request.requestId, null, 'expired')
      }, APPROVAL_TIMEOUT_MS)
      // 不让人等死：定时器不该单独把进程撑活
      timer.unref?.()
      waiters.set(request.requestId, { request, resolve, timer })
      persist(request)
      publish({ type: 'approval_requested', approval: request })
    })
  }

  function pending(threadID?: string): ApprovalRequest[] {
    const all: ApprovalRequest[] = []
    for (const waiter of waiters.values()) {
      if (threadID === undefined || waiter.request.threadID === threadID) {
        all.push(waiter.request)
      }
    }
    return all.sort(function (a, b) {
      return a.createdAt - b.createdAt
    })
  }

  function pendingOf(sessionId: string): ApprovalRequest | undefined {
    for (const waiter of waiters.values()) {
      if (waiter.request.sessionId === sessionId) return waiter.request
    }
    return undefined
  }

  function cancelThread(threadID: string): void {
    for (const request of pending(threadID)) {
      finish(request.requestId, null, 'cancelled')
    }
  }

  function cancelAll(): void {
    for (const request of pending()) {
      finish(request.requestId, null, 'cancelled')
    }
  }

  function subscribe(listener: (event: ApprovalEvent) => void): () => void {
    listeners.add(listener)
    return function () {
      listeners.delete(listener)
    }
  }

  return {
    ask,
    settle,
    settleFor,
    pending,
    pendingOf,
    subscribe,
    cancelThread,
    cancelAll
  }
}

export { createApprovalHub }
export type { ApprovalEvent, ApprovalHub, ApprovalRequest, ApprovalAskInput }
