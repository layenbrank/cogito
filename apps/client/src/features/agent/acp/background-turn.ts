/**
 * 后台回合：ACP 消费与 UI AbortSignal 解耦。
 *
 * assistant-ui 在卸载 local runtime 时会 `detach()` → `AbortSignal`（`reason.detach === true`）。
 * 若把该信号直接交给 goose `cancellationSignal`，离开 Agent 页等于中止任务 —— 与「主进程未退出
 * 则会话应后台继续」冲突。
 *
 * 这里按 thread 登记一轮独立泵：UI 只是订阅者。`detach` 不取消 goose；用户点「停止」
 * （`AbortError.detach !== true`）才 abort。卸载后再打开走 `history.resume` 重放缓冲 + 续尾。
 *
 * 事件权威缓冲在 Rust `agentTurn:*`（有界 ring）；TS `events[]` 只保留薄镜像（`TURN_EVENT_CAP`）。
 */
import type { ChatStreamEvent } from '@cogito/chat/ports'

import {
  appendAgentTurn,
  clearAgentTurnRunning,
  ensureAgentTurn,
  finishAgentTurn,
  followAgentTurn,
  listAgentTurnRunning,
  markAgentTurnRunning
} from '@/features/agent/acp/agent-turn-ipc'

type TurnListener = (event: ChatStreamEvent | null) => void

interface BackgroundTurn {
  threadID: string
  /** 薄镜像：有上限；权威副本在 Rust */
  events: ChatStreamEvent[]
  status: 'running' | 'done'
  cancel: AbortController
  listeners: Set<TurnListener>
  /** 是否有订阅者已经拿到终态事件（有则历史由 assistant-ui 落库，后台不再补写） */
  deliveredTerminal: boolean
  /** 建泵时绑定的 start：running 回合被再次订阅时校验是不是同一轮 */
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
  /** 建泵那一刻捕获的补写器：后续 rebind 不影响已开跑的回合 */
  persister: TurnPersister | null
  /** 待刷到 Rust 的事件批（微任务合并） */
  pendingAppend: ChatStreamEvent[]
  appendScheduled: boolean
}

const turns = new Map<string, BackgroundTurn>()

/** 回合结束后短暂保留，方便 remount 的 `resume` 接到缓冲 */
const TURN_RETENTION_MS = 60_000

/**
 * 本地镜像条数上限（与 Rust `MAX_EVENTS` 对齐）。
 * 超出丢掉最旧，保留最近窗口供同步订阅 / 回退。
 */
const TURN_EVENT_CAP = 4_000

/** Rust follow 空转轮询间隔（有本地 turn 时改用 notify 唤醒） */
const RUST_FOLLOW_POLL_MS = 32

/** 刷新后恢复兜底：Rust 不可用时仍可读 localStorage */
const RUNNING_TURNS_KEY = 'cogito:agent:running-turns'

/** 列出「正在跑」thread 集合（同步路径读 localStorage；由 mark/clear / 启动同步回写） */
function readRunningTurns(): string[] {
  try {
    const raw = window.localStorage.getItem(RUNNING_TURNS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch (error) {
    console.warn('[acp/background-turn] 读 running 集合失败，按空处理:', error)
    return []
  }
}

function writeRunningTurns(ids: string[]): void {
  try {
    window.localStorage.setItem(RUNNING_TURNS_KEY, JSON.stringify(ids))
  } catch (error) {
    console.warn('[acp/background-turn] 写 running 集合失败:', error)
  }
}

function markPersistedRunning(threadID: string): void {
  const ids = readRunningTurns()
  if (!ids.includes(threadID)) {
    ids.push(threadID)
    writeRunningTurns(ids)
  }
  void markAgentTurnRunning(threadID).then(function (next) {
    if (next) writeRunningTurns(next)
  })
}

function clearPersistedRunning(threadID: string): void {
  const ids = readRunningTurns()
  const next = ids.filter(function (id) {
    return id !== threadID
  })
  if (next.length !== ids.length) writeRunningTurns(next)
  void clearAgentTurnRunning(threadID).then(function (remote) {
    if (remote) writeRunningTurns(remote)
  })
}

/** 刷新后「这轮还在跑」的判定：内存态丢了就查持久化标记 */
function hasPersistedRunningTurn(threadID: string): boolean {
  return readRunningTurns().includes(threadID.trim())
}

/** 启动时尽量用 Rust running 集合覆盖 localStorage 镜像 */
function syncRunningTurnsFromRust(): void {
  void listAgentTurnRunning().then(function (ids) {
    if (ids) writeRunningTurns(ids)
  })
}

if (typeof window !== 'undefined') {
  syncRunningTurnsFromRust()
}

type TurnPersister = (turn: BackgroundTurn) => void | Promise<void>
let persister: TurnPersister | null = null

/** 无 UI 订阅终态时补写历史（由 `port/thread-history` 登记） */
function bindBackgroundTurnPersister(next: TurnPersister | null) {
  persister = next
}

/**
 * 回合结束钩子：UI 已 detach 时也能收到「这一轮跑完了」。
 *
 * 目标推进靠它续跑 —— 用户在别的会话时，原线程仍然要一轮接一轮往下推。
 */
type TurnFinishedHook = (turn: BackgroundTurn) => void | Promise<void>
const finishedHooks = new Set<TurnFinishedHook>()

function onBackgroundTurnFinished(hook: TurnFinishedHook): () => void {
  finishedHooks.add(hook)
  return function () {
    finishedHooks.delete(hook)
  }
}

async function notifyTurnFinished(turn: BackgroundTurn): Promise<void> {
  for (const hook of [...finishedHooks]) {
    try {
      await hook(turn)
    } catch (error) {
      console.warn('[acp/background-turn] 回合结束钩子异常:', error)
    }
  }
}

function isDetachAbort(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason
  return Boolean(
    reason !== null &&
      typeof reason === 'object' &&
      'detach' in reason &&
      (reason as { detach?: unknown }).detach === true
  )
}

function isTerminalEvent(event: ChatStreamEvent): boolean {
  return event.kind === 'finish' || event.kind === 'aborted' || event.kind === 'error'
}

function bindUiCancel(uiSignal: AbortSignal | undefined, cancel: AbortController): () => void {
  if (!uiSignal) return function () {}

  // 窄化到非空后另存一份：嵌套的 onAbort 拿不到外层 if 的窄化结果
  const signal = uiSignal
  function onAbort() {
    if (isDetachAbort(signal)) return
    if (!cancel.signal.aborted) cancel.abort(signal.reason)
  }

  if (signal.aborted) {
    onAbort()
    return function () {}
  }

  signal.addEventListener('abort', onAbort)
  return function () {
    signal.removeEventListener('abort', onAbort)
  }
}

function waitForTurnEvent(turn: BackgroundTurn): Promise<void> {
  return new Promise(function (resolve) {
    const listener: TurnListener = function () {
      turn.listeners.delete(listener)
      resolve()
    }
    turn.listeners.add(listener)
  })
}

function waitMs(ms: number): Promise<void> {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, ms)
  })
}

function notifyTurn(turn: BackgroundTurn, event: ChatStreamEvent | null) {
  for (const listener of [...turn.listeners]) listener(event)
}

function forgetTurnLater(turn: BackgroundTurn) {
  window.setTimeout(function () {
    if (turns.get(turn.threadID) === turn && turn.status === 'done') {
      // retention 到期再丢本地镜像，避免与仍在 yield 的订阅者竞态
      turn.events = []
      turn.pendingAppend = []
      turns.delete(turn.threadID)
    }
  }, TURN_RETENTION_MS)
}

function pushLocalEvent(turn: BackgroundTurn, event: ChatStreamEvent) {
  turn.events.push(event)
  if (turn.events.length > TURN_EVENT_CAP) {
    const overflow = turn.events.length - TURN_EVENT_CAP
    turn.events.splice(0, overflow)
  }
}

function flushPendingAppend(turn: BackgroundTurn) {
  turn.appendScheduled = false
  if (turn.pendingAppend.length === 0) return
  const batch = turn.pendingAppend.splice(0, turn.pendingAppend.length)
  void appendAgentTurn(turn.threadID, batch)
}

function dualWriteEvent(turn: BackgroundTurn, event: ChatStreamEvent) {
  pushLocalEvent(turn, event)
  turn.pendingAppend.push(event)
  if (turn.appendScheduled) return
  turn.appendScheduled = true
  queueMicrotask(function () {
    flushPendingAppend(turn)
  })
}

function ensureBackgroundTurn(
  threadID: string,
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
): BackgroundTurn {
  const existing = turns.get(threadID)
  if (existing && existing.status === 'running') {
    // 同一 thread 只允许一轮在跑；start 不同说明有人拿旧 id 另起一轮，静默复用会把
    // 新输入接到旧泵上 —— 直接报错暴露，不吞
    if (existing.start !== start) {
      throw new Error('[acp/background-turn] 同一 thread 已有不同 start 的回合在跑')
    }
    return existing
  }

  const cancel = new AbortController()
  const turn: BackgroundTurn = {
    threadID,
    events: [],
    status: 'running',
    cancel,
    listeners: new Set(),
    deliveredTerminal: false,
    start,
    persister,
    pendingAppend: [],
    appendScheduled: false
  }
  turns.set(threadID, turn)
  markPersistedRunning(threadID)
  void ensureAgentTurn(threadID)

  void (async function () {
    try {
      for await (const event of start(cancel.signal)) {
        dualWriteEvent(turn, event)
        notifyTurn(turn, event)
        if (isTerminalEvent(event)) break
      }
    } catch (error) {
      // 泵异常也要变成可重放的终态，否则 resume 会永远等 running
      console.warn('[acp/background-turn] 回合泵异常:', error)
      if (!turn.events.some(isTerminalEvent)) {
        const message = error instanceof Error ? error.message : String(error)
        const failed: ChatStreamEvent = { kind: 'error', message }
        dualWriteEvent(turn, failed)
        notifyTurn(turn, failed)
      }
    } finally {
      flushPendingAppend(turn)
      turn.status = 'done'
      clearPersistedRunning(turn.threadID)
      await finishAgentTurn(turn.threadID)
      notifyTurn(turn, null)
      if (!turn.deliveredTerminal && turn.persister) {
        try {
          await turn.persister(turn)
        } catch (error) {
          console.warn('[acp/background-turn] 补写历史失败:', error)
        }
      }
      // 先落历史再通知：续跑那一轮要能读到上一轮的消息
      await notifyTurnFinished(turn)
      forgetTurnLater(turn)
    }
  })()

  return turn
}

/**
 * 订阅（或新建）某 thread 的后台回合：先重放缓冲，再跟实时尾部。
 *
 * UI `detach` 只会结束本生成器，**不会**停泵；显式停止才会 `cancel.abort()`。
 */
async function* consumeBackgroundTurn(
  threadID: string,
  uiSignal: AbortSignal | undefined,
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const turn = ensureBackgroundTurn(threadID, start)
  const unbind = bindUiCancel(uiSignal, turn.cancel)

  try {
    let index = 0
    while (true) {
      while (index < turn.events.length) {
        const event = turn.events[index]
        index += 1
        if (isTerminalEvent(event)) turn.deliveredTerminal = true
        yield event
        if (isTerminalEvent(event)) return
      }
      if (turn.status === 'done') return
      await waitForTurnEvent(turn)
    }
  } finally {
    unbind()
  }
}

/** 优先 Rust `agentTurn:follow`（cursor）；环缓冲缺失时回退本地 `events[]`。 */
async function* followBackgroundTurn(
  threadID: string,
  uiSignal: AbortSignal | undefined
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const local = turns.get(threadID)
  const cancel = local?.cancel ?? new AbortController()
  const unbind = bindUiCancel(uiSignal, cancel)

  try {
    let cursor = 0
    let sawRust = false

    while (true) {
      const followed = await followAgentTurn(threadID, cursor)
      if (!followed || followed.status === 'missing') break

      sawRust = true
      for (const event of followed.events) {
        if (local && isTerminalEvent(event)) local.deliveredTerminal = true
        yield event
        if (isTerminalEvent(event)) return
      }
      cursor = followed.nextCursor
      if (followed.status === 'done') return

      if (local && local.status === 'running') {
        await waitForTurnEvent(local)
      } else {
        await waitMs(RUST_FOLLOW_POLL_MS)
      }
    }

    if (sawRust) return

    // 薄回退：仅内存态
    const turn = turns.get(threadID)
    if (!turn) return

    let index = 0
    while (true) {
      while (index < turn.events.length) {
        const event = turn.events[index]
        index += 1
        if (isTerminalEvent(event)) turn.deliveredTerminal = true
        yield event
        if (isTerminalEvent(event)) return
      }
      if (turn.status === 'done') return
      await waitForTurnEvent(turn)
    }
  } finally {
    unbind()
  }
}

/**
 * orphan 落库用：优先 Rust 全量，失败再回落本地镜像。
 */
async function findTurnEvents(turn: BackgroundTurn): Promise<ChatStreamEvent[]> {
  const remote = await followAgentTurn(turn.threadID, 0)
  if (remote && remote.events.length > 0) return remote.events
  return turn.events
}

function hasRunningBackgroundTurn(threadID: string): boolean {
  const turn = turns.get(threadID.trim())
  return Boolean(turn && turn.status === 'running')
}

function findBackgroundTurn(threadID: string): BackgroundTurn | null {
  return turns.get(threadID.trim()) ?? null
}

/** 测试 / 清理：丢掉全部登记（不 abort goose；调用方需自行 cancel） */
function clearBackgroundTurns() {
  turns.clear()
}

export {
  bindBackgroundTurnPersister,
  clearBackgroundTurns,
  clearPersistedRunning,
  consumeBackgroundTurn,
  ensureBackgroundTurn,
  findBackgroundTurn,
  findTurnEvents,
  followBackgroundTurn,
  hasPersistedRunningTurn,
  hasRunningBackgroundTurn,
  isDetachAbort,
  isTerminalEvent,
  onBackgroundTurnFinished,
  readRunningTurns,
  syncRunningTurnsFromRust
}
export type { BackgroundTurn }
