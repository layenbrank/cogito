/**
 * 线程事件流：把 goose 的 `session/update` 原样送到前端。
 *
 * ## 为什么不复用 `/runs/stream`
 *
 * `/runs/stream` 吐的是 **图状态**（`values` / `updates`），它的生命周期等于「一次图的执行」。
 * 但前端要的是「一次会话的连续事件」：工具卡增量、审批请求、回合结束，这些都发生在图的
 * 执行**内部**，而且一个 thread 可能连着跑好几轮。所以两者分开：
 *
 * - `/runs/stream`：LangGraph SDK 兼容面（快照、interrupt、resume）；
 * - `/threads/:id/events`：会话事件面（本文件），SSE + 游标续传。
 *
 * ## 游标
 *
 * `seq` 是进程内全局单调递增，`epoch` 标识进程。前端断线重连时带 `?after=<seq>&epoch=<epoch>`：
 * - 同 epoch：从**持久日志**补发 `seq > after` 的事件；
 * - 不同 epoch：服务端回 `reset`，客户端丢弃旧游标；
 * - 补发位置已被淘汰：`truncated=true`。
 *
 * 内存缓冲只服务实时尾部；补发由 [`RunEventStore`] 承担，避免「裁剪后静默缺段」。
 */

import { randomUUID } from 'node:crypto'

import type { RunEventStore } from './event-store'

interface RunEvent {
  /** 进程启动标识：`seq` 只在同一 epoch 内可比较 */
  epoch: string
  /** 全局单调序号；同一条流内严格递增 */
  seq: number
  threadID: string
  /**
   * `update` = goose 的 session/update；`replay` = 补历史时 `session/load` 重放的那批 update
   * （形状与 `update` 相同，但客户端要**替换**而不是追加）；`approval`/`elicitation` = 等人；
   * `*_settled` = 票据结案（广播给所有客户端）；`status` = 回合级状态
   */
  kind:
    | 'update'
    | 'replay'
    | 'approval'
    | 'elicitation'
    | 'approval_settled'
    | 'elicitation_settled'
    | 'status'
  payload?: unknown
  /** 归属哪一轮（approval/status 尽量带上，便于按 run 结案） */
  runID?: string
  createdAt: number
}

/** 每线程保留多少条内存热缓冲（持久化之后它只服务实时尾部，不再承担补发） */
const BUFFER_LIMIT = 2000

type RunEventListener = (event: RunEvent) => void

interface ReplayResult {
  events: RunEvent[]
  epoch: string
  minSeq: number | null
  /** 请求的位置已被淘汰：正文有缺段，客户端应重建 */
  truncated: boolean
  /** 请求的 epoch 与服务端不同：客户端必须丢弃旧游标 */
  reset: boolean
}

interface EventHubOptions {
  /** 持久化存储；不传则退化为纯内存（单测 / CI） */
  store?: RunEventStore | null
  /** 进程启动标识 */
  epoch?: string
  /** 写库失败时回调一次；调用方据此打日志/告警 */
  onStoreError?: (error: unknown) => void
}

interface EventHub {
  emit(threadID: string, kind: RunEvent['kind'], payload?: unknown, runID?: string): RunEvent
  /** 取 `afterSeq` 之后的事件（不含）；不传则返回缓冲里的全部。仅内存（单测用） */
  since(threadID: string, afterSeq?: number): RunEvent[]
  /** 补发：优先持久日志；返回 gap/epoch 语义 */
  replay(threadID: string, afterSeq?: number, epoch?: string): ReplayResult
  subscribe(threadID: string, listener: RunEventListener): () => void
  /** 线程结束时丢掉缓冲（`/threads` 本身由 agent-server 管，这里只清事件） */
  clear(threadID: string): void
  clearAll(): void
  epoch(): string
  /** 当前事件是否确实落库（写失败后会变 false） */
  durable(): boolean
  prune(beforeMs: number): number
}

function createEventHub(options: EventHubOptions = {}): EventHub {
  const buffers = new Map<string, RunEvent[]>()
  const listeners = new Map<string, Set<RunEventListener>>()
  const store = options.store ?? null
  const epoch = options.epoch ?? randomUUID()
  let seq = 0
  let durable = Boolean(store)
  let storeErrorReported = false

  function emit(
    threadID: string,
    kind: RunEvent['kind'],
    payload?: unknown,
    runID?: string
  ): RunEvent {
    seq += 1
    const event: RunEvent = {
      epoch,
      seq,
      threadID,
      kind,
      payload,
      ...(runID ? { runID } : {}),
      createdAt: Date.now()
    }

    // 先落库再广播：顺序反过来会出现「已广播但没落库」，断线后补发不到
    if (store && durable) {
      try {
        store.insert(event)
      } catch (error) {
        durable = false
        if (!storeErrorReported) {
          storeErrorReported = true
          options.onStoreError?.(error)
        }
      }
    }

    const buffer = buffers.get(threadID) ?? []
    buffer.push(event)
    if (buffer.length > BUFFER_LIMIT) buffer.splice(0, buffer.length - BUFFER_LIMIT)
    buffers.set(threadID, buffer)

    const set = listeners.get(threadID)
    if (set) {
      for (const listener of set) {
        try {
          listener(event)
        } catch {
          // 订阅者自己炸了不该影响事件产生
        }
      }
    }
    return event
  }

  function since(threadID: string, afterSeq?: number): RunEvent[] {
    const buffer = buffers.get(threadID) ?? []
    if (afterSeq === undefined) return [...buffer]
    return buffer.filter(function (event) {
      return event.seq > afterSeq
    })
  }

  function replay(threadID: string, afterSeq?: number, requestedEpoch?: string): ReplayResult {
    // 请求的是上一个进程的游标：不比较 seq，直接让客户端重置
    if (requestedEpoch !== undefined && requestedEpoch !== epoch) {
      return { events: [], epoch, minSeq: null, truncated: false, reset: true }
    }

    const from = afterSeq ?? 0
    if (store && durable) {
      const result = store.replay(threadID, epoch, from)
      return {
        events: result.events,
        epoch,
        minSeq: result.minSeq,
        truncated: from > 0 && result.minSeq !== null && from < result.minSeq - 1,
        reset: false
      }
    }

    const events = since(threadID, from)
    const minSeq = (buffers.get(threadID) ?? [])[0]?.seq ?? null
    return {
      events,
      epoch,
      minSeq,
      truncated: from > 0 && minSeq !== null && from < minSeq - 1,
      reset: false
    }
  }

  function subscribe(threadID: string, listener: RunEventListener): () => void {
    const set = listeners.get(threadID) ?? new Set<RunEventListener>()
    set.add(listener)
    listeners.set(threadID, set)
    return function () {
      set.delete(listener)
      if (set.size === 0) listeners.delete(threadID)
    }
  }

  function clear(threadID: string): void {
    buffers.delete(threadID)
    store?.clearThread(threadID)
  }

  function clearAll(): void {
    buffers.clear()
    store?.clearAll()
  }

  return {
    emit,
    since,
    replay,
    subscribe,
    clear,
    clearAll,
    epoch: function () {
      return epoch
    },
    durable: function () {
      return durable
    },
    prune: function (beforeMs: number): number {
      return store ? store.prune(beforeMs) : 0
    }
  }
}

export { BUFFER_LIMIT, createEventHub }
export type { EventHub, EventHubOptions, ReplayResult, RunEvent, RunEventListener }

