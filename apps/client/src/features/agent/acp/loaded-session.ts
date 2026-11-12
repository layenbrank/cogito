/**
 * 用 `session/load` 接回来的会话，包成 `ActiveSession` 的最小实现。
 *
 * 为什么需要这层：SDK 的 `ActiveSession` 只能由 `buildSession(...).start()` 造出来
 * （`attachSession` 是私有的），而「第二天打开同一个会话」必须走 `session/load` ——
 * 它把 goose 侧已有的会话 attach 回当前连接，并把历史重放成 `session/update` 通知。
 * 没有这层，`ensureThreadSession` 每次都只有 `session/new` 一条路，于是 UI 里历史还在、
 * goose 侧却是一个全新会话：Agent 不认识这个对话，也看不到之前的约定。
 *
 * 只实现调用方用得到的四个口：`sessionId` / `newSessionResponse` / `prompt` /
 * `nextUpdate` / `dispose`。`prompt` 的收尾方式和 SDK v1 一致：请求解析后往队列里
 * 塞一条 `{ kind: 'stop' }`，`runThreadPrompt` 的泵读的就是这个形状。
 */
import type {
  ActiveSession,
  ClientConnection,
  ContentBlock,
  PromptResponse,
  SessionNotification,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import { methods } from '@agentclientprotocol/sdk'

/** 泵认的两种消息（与 SDK v1 的 `nextUpdate()` 同形） */
type LoadedSessionMessage =
  | { kind: 'session_update'; notification: SessionNotification; update: SessionUpdate }
  | { kind: 'stop'; response?: PromptResponse | null; stopReason?: string | null }

/**
 * 会话的 update 队列。
 *
 * 语义照着 SDK 的 AsyncQueue 收窄到够用：先攒后取、有等待者就直接给、出错时把等待者
 * 全部打回（否则 `runThreadPrompt` 的泵会永远挂在一个不会来的 update 上）。
 */
class LoadedQueue {
  private items: LoadedSessionMessage[] = []
  private waiters: Array<{
    resolve: (message: LoadedSessionMessage) => void
    reject: (error: unknown) => void
  }> = []
  private error: unknown = null
  private closed = false

  push(message: LoadedSessionMessage): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) waiter.resolve(message)
    else this.items.push(message)
  }

  fail(error: unknown): void {
    this.error = error
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) waiter.reject(error)
  }

  clearErrors(): void {
    this.error = null
  }

  next(): Promise<LoadedSessionMessage> {
    const queued = this.items.shift()
    if (queued) return Promise.resolve(queued)
    if (this.error) {
      const error = this.error
      this.error = null
      return Promise.reject(error)
    }
    return new Promise<LoadedSessionMessage>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  /** 会话被关掉 / 连接断了：把还挂着的读打回，别让泵悬着 */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.items = []
    const waiters = this.waiters.splice(0)
    const error = new Error('会话已关闭')
    for (const waiter of waiters) waiter.reject(error)
  }
}

interface LoadedEntry {
  queue: LoadedQueue
}

/** acpSessionID → 已接上的会话（`session/update` 按这个路由） */
const loadedSessions = new Map<string, LoadedEntry>()

interface CreateLoadedSessionInput {
  connection: ClientConnection
  sessionId: string
  /** `session/load` 返回的 configOptions（goose 可能不给） */
  configOptions?: unknown
}

/**
 * 造一个「已接上」的会话：`session/load` 成功之后调用。
 *
 * 注意顺序：**先 load 再建**。load 会把整段历史重放成通知；那时还没有队列，
 * 重放内容会被丢掉 —— 正是想要的（UI 的历史来自 SQLite，不重复产）。
 */
function createLoadedSession(input: CreateLoadedSessionInput): ActiveSession {
  const { connection, sessionId, configOptions } = input
  const queue = new LoadedQueue()
  loadedSessions.set(sessionId, { queue })

  const sessionResponse = {
    sessionId,
    configOptions: (configOptions as never) ?? null,
    modes: null,
    _meta: null
  }

  const session = {
    sessionId,
    get configOptions() {
      return sessionResponse.configOptions
    },
    get modes() {
      return sessionResponse.modes
    },
    get newSessionResponse() {
      return sessionResponse
    },
    prompt(prompt: string | ContentBlock | ContentBlock[], options?: {
      cancellationSignal?: AbortSignal
    }): Promise<PromptResponse> {
      queue.clearErrors()
      const blocks: ContentBlock[] =
        typeof prompt === 'string'
          ? [{ type: 'text' as const, text: prompt }]
          : Array.isArray(prompt)
            ? prompt
            : [prompt]
      const response = connection.agent.request(
        methods.agent.session.prompt,
        { sessionId, prompt: blocks },
        options
      )
      void response.then(
        function (value) {
          queue.push({ kind: 'stop', response: value, stopReason: value?.stopReason ?? null })
        },
        function (error: unknown) {
          queue.fail(error)
        }
      )
      return response
    },
    nextUpdate(): Promise<LoadedSessionMessage> {
      return queue.next()
    },
    dispose(): void {
      const entry = loadedSessions.get(sessionId)
      if (entry && entry.queue === queue) loadedSessions.delete(sessionId)
      queue.close()
    }
  }

  return session as unknown as ActiveSession
}

/**
 * 把一条 `session/update` 通知喂给对应的已接上会话。
 *
 * 返回 false 表示这个 sessionId 没有已接上的会话（调用方不需要再管）。
 */
function feedLoadedSession(notification: SessionNotification): boolean {
  const entry = loadedSessions.get(notification.sessionId)
  if (!entry) return false
  entry.queue.push({
    kind: 'session_update',
    notification,
    update: notification.update
  })
  return true
}

/** 连接断开 / 会话作废：清掉路由与队列 */
function forgetLoadedSession(sessionId: string): void {
  const entry = loadedSessions.get(sessionId)
  if (!entry) return
  loadedSessions.delete(sessionId)
  entry.queue.close()
}

function hasLoadedSession(sessionId: string): boolean {
  return loadedSessions.has(sessionId)
}

export { createLoadedSession, feedLoadedSession, forgetLoadedSession, hasLoadedSession }