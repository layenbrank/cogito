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
 * `seq` 全局单调递增。前端断线重连时带 `?after=<seq>`，这里把缓冲里更新的补发一遍。
 * 缓冲按线程限制条数（[`BUFFER_LIMIT`]）—— 桌面端一轮几千条 update 很常见，不能无限攒。
 */

interface RunEvent {
  /** 全局单调序号；同一条流内严格递增 */
  seq: number
  threadID: string
  /** `update` = goose 的 session/update；`approval`/`elicitation` = 等人；`status` = 回合级状态 */
  kind: 'update' | 'approval' | 'elicitation' | 'status'
  payload?: unknown
  createdAt: number
}

/** 每线程保留多少条（够断线补发，又不至于把内存吃满）。 */
const BUFFER_LIMIT = 2000

type RunEventListener = (event: RunEvent) => void

interface EventHub {
  emit(threadID: string, kind: RunEvent['kind'], payload?: unknown): RunEvent
  /** 取 `afterSeq` 之后的事件（不含）；不传则返回缓冲里的全部 */
  since(threadID: string, afterSeq?: number): RunEvent[]
  subscribe(threadID: string, listener: RunEventListener): () => void
  /** 线程结束时丢掉缓冲（`/threads` 本身由 agent-server 管，这里只清事件） */
  clear(threadID: string): void
  clearAll(): void
}

function createEventHub(): EventHub {
  const buffers = new Map<string, RunEvent[]>()
  const listeners = new Map<string, Set<RunEventListener>>()
  let seq = 0

  function emit(threadID: string, kind: RunEvent['kind'], payload?: unknown): RunEvent {
    seq += 1
    const event: RunEvent = { seq, threadID, kind, payload, createdAt: Date.now() }
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
  }

  function clearAll(): void {
    buffers.clear()
  }

  return { emit, since, subscribe, clear, clearAll }
}

export { BUFFER_LIMIT, createEventHub }
export type { EventHub, RunEvent, RunEventListener }
