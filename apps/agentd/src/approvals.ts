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
 * - 判定规则本身不在这里：哪个选项算「允许」由 `@cogito/agent-protocol/policy` 决定，
 *   这里只负责转发 `optionId`。
 * - 进程退出时会把所有等待者拒掉，避免 HTTP 侧永远挂起。
 */

import { randomUUID } from 'node:crypto'

import type { PermissionChoice, PermissionDecision } from './goose/client'

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
}

function createApprovalHub(): ApprovalHub {
  const waiters = new Map<string, Waiter>()
  const listeners = new Set<(event: ApprovalEvent) => void>()

  function publish(event: ApprovalEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // 订阅者自己的问题不该影响审批流程
      }
    }
  }

  function settle(requestId: string, optionId: string | null): boolean {
    const waiter = waiters.get(requestId)
    if (!waiter) return false
    waiters.delete(requestId)
    publish({
      type: 'approval_settled',
      approval: waiter.request,
      optionId
    })
    waiter.resolve(optionId === null ? null : { optionId })
    return true
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
      waiters.set(request.requestId, { request, resolve })
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
      settle(request.requestId, null)
    }
  }

  function cancelAll(): void {
    for (const request of pending()) {
      settle(request.requestId, null)
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
    pending,
    pendingOf,
    subscribe,
    cancelThread,
    cancelAll
  }
}

export { createApprovalHub }
export type { ApprovalEvent, ApprovalHub, ApprovalRequest, ApprovalAskInput }
