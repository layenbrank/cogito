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
  forgetAgentTurn,
  listAgentTurnRunning,
  markAgentTurnRunning
} from '@/features/agent/acp/agent-turn-ipc'

type TurnListener = (event: ChatStreamEvent | null) => void

interface BackgroundTurn {
  threadID: string
  /** 薄镜像：有上限；权威副本在 Rust */
  events: ChatStreamEvent[]
  /**
   * `events` 因 CAP 从队首丢掉的条数。订阅方的 `index` 必须减去增量，
   * 否则会卡在 `index === length` 永远扫不到新事件（长回合冻流）。
   */
  dropped: number
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
  /** 串行化 append IPC，finish 前必须排空 */
  appendFlight: Promise<void>
}

const turns = new Map<string, BackgroundTurn>()

/** 回合结束后短暂保留，方便 remount 的 `resume` 接到缓冲 */
const TURN_RETENTION_MS = 60_000

/**
 * 抢占旧回合的等待上限：超过就强行让位。
 *
 * 取消是协作式的 —— 正在跑的工具（dev server、大构建、卡住的网络请求）可能几分钟
 * 都不回应 `session/cancel`。以前这里 `while (running) await ...` 没有上限，
 * 于是「编辑后点更新」会永远挂在 `ensureBackgroundTurn` 里：界面不再刷新、
 * 也不报错，只有整页重载才恢复。给一个上限，宁可让旧回合在后台自行收尾。
 */
const SUPERSEDE_WAIT_MS = 6_000

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

/**
 * 用户点「停止」：assistant-ui `cancelRun` → `AbortError(detach: false)`。
 *
 * 注意：`performRoundtrip` 开新轮时会 `abort()` **无 reason**——那不能当作用户停止，
 * 否则会把仍在跑的 goose 泵掐成半截输出。仅显式 `detach === false` 才杀泵。
 */
function isUserStopAbort(signal: AbortSignal): boolean {
  const reason: unknown = signal.reason
  return Boolean(
    reason !== null &&
      typeof reason === 'object' &&
      'detach' in reason &&
      (reason as { detach?: unknown }).detach === false
  )
}

function isTerminalEvent(event: ChatStreamEvent): boolean {
  return event.kind === 'finish' || event.kind === 'aborted' || event.kind === 'error'
}

function synthesizeMissingTerminal(cancel: AbortSignal): ChatStreamEvent {
  if (cancel.aborted) {
    return { kind: 'aborted', usage: {} }
  }
  return {
    kind: 'error',
    message: '回合异常结束：未收到终态（输出可能不完整）',
    usage: {}
  }
}

function bindUiCancel(uiSignal: AbortSignal | undefined, cancel: AbortController): () => void {
  if (!uiSignal) return function () {}

  // 窄化到非空后另存一份：嵌套的 onAbort 拿不到外层 if 的窄化结果
  const signal = uiSignal
  function onAbort() {
    // 仅用户停止才转发到 goose；detach / bare abort 只结束 UI 订阅
    if (!isUserStopAbort(signal)) return
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

function waitForTurnEvent(turn: BackgroundTurn, timeoutMs?: number): Promise<void> {
  return new Promise(function (resolve) {
    const listener: TurnListener = function () {
      turn.listeners.delete(listener)
      resolve()
    }
    turn.listeners.add(listener)
    // 有上限：抢占旧回合时不能被一个不响应的工具无限拖住
    if (timeoutMs === undefined) return
    window.setTimeout(function () {
      turn.listeners.delete(listener)
      resolve()
    }, Math.max(0, timeoutMs))
  })
}

/** UI abort（detach / stop）要能打断无限 wait，否则订阅挂死、适配器落成「流异常」 */
function waitForUiAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise(function () {})
  if (signal.aborted) return Promise.resolve()
  return new Promise(function (resolve) {
    signal.addEventListener('abort', function () {
      resolve()
    }, { once: true })
  })
}

async function waitForTurnOrUiAbort(
  turn: BackgroundTurn,
  uiSignal: AbortSignal | undefined,
  timeoutMs?: number
): Promise<void> {
  await Promise.race([waitForTurnEvent(turn, timeoutMs), waitForUiAbort(uiSignal)])
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
      void forgetAgentTurn(turn.threadID)
    }
  }, TURN_RETENTION_MS)
}

function pushLocalEvent(turn: BackgroundTurn, event: ChatStreamEvent) {
  turn.events.push(event)
  if (turn.events.length > TURN_EVENT_CAP) {
    const overflow = turn.events.length - TURN_EVENT_CAP
    turn.events.splice(0, overflow)
    turn.dropped += overflow
  }
}

/** 订阅游标对齐 CAP 裁剪；返回修正后的 index 与已对齐的 dropped 水位 */
function alignSubscribeIndex(
  index: number,
  seenDropped: number,
  turn: BackgroundTurn
): { index: number; seenDropped: number } {
  if (turn.dropped <= seenDropped) return { index, seenDropped }
  const delta = turn.dropped - seenDropped
  return {
    index: Math.max(0, index - delta),
    seenDropped: turn.dropped
  }
}

/**
 * 把 pending 批接到 appendFlight 链上；空批也返回当前 in-flight，
 * 供 finally 在 finish 前排空。
 */
function flushPendingAppend(turn: BackgroundTurn): Promise<void> {
  turn.appendScheduled = false
  if (turn.pendingAppend.length === 0) return turn.appendFlight

  const batch = turn.pendingAppend.splice(0, turn.pendingAppend.length)
  turn.appendFlight = turn.appendFlight
    .catch(function () {
      // 前一次失败不阻断后续批写
    })
    .then(function () {
      return appendAgentTurn(turn.threadID, batch)
    })
    .then(function () {})
    .catch(function (error) {
      console.warn('[acp/background-turn] append 失败:', error)
    })
  return turn.appendFlight
}

/** 泵结束后：冲掉残余 pending + 等所有 in-flight IPC 完成，再允许 finish */
async function drainPendingAppend(turn: BackgroundTurn): Promise<void> {
  turn.appendScheduled = false
  await flushPendingAppend(turn)
  // 微任务里可能又排队了一次 flush（与 finally 竞态）：再冲一轮
  await flushPendingAppend(turn)
}

function dualWriteEvent(turn: BackgroundTurn, event: ChatStreamEvent) {
  pushLocalEvent(turn, event)
  turn.pendingAppend.push(event)
  if (turn.appendScheduled) return
  turn.appendScheduled = true
  queueMicrotask(function () {
    void flushPendingAppend(turn)
  })
}

function pushTurnEvent(threadID: string, event: ChatStreamEvent): boolean {
  const turn = turns.get(threadID.trim())
  if (!turn || turn.status !== 'running') return false
  dualWriteEvent(turn, event)
  notifyTurn(turn, event)
  return true
}

/** 中止某 thread 正在跑的后台泵，并等到 `status === 'done'`（含 drain）。
 * 无 running 回合时立即返回。编辑 / 重发 / steer / 目标续跑开新轮前调用。
 */
async function abortBackgroundTurn(threadID: string): Promise<void> {
  const key = threadID.trim()
  const existing = turns.get(key)
  if (!existing || existing.status !== 'running') return

  if (!existing.cancel.signal.aborted) {
    existing.cancel.abort({ name: 'AbortError', reason: 'superseded' })
  }

  // 等到 finally 把 status 标成 done（notify 会唤醒 waitForTurnEvent）
  const deadline = Date.now() + SUPERSEDE_WAIT_MS
  while (existing.status === 'running') {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      // 旧回合不肯收尾：把它从登记表里摘掉，让新一轮先跑起来。
      // 旧泵仍在后台，事件继续写自己的缓冲，但不再阻塞 UI 的发送链路。
      console.warn('[acp/background-turn] 旧回合未在时限内收尾，强行让位:', key)
      if (!existing.events.some(isTerminalEvent)) {
        const missing: ChatStreamEvent = { kind: 'aborted', usage: {} }
        pushLocalEvent(existing, missing)
        notifyTurn(existing, missing)
      }
      existing.status = 'done'
      if (turns.get(key) === existing) turns.delete(key)
      clearPersistedRunning(key)
      void finishAgentTurn(key).catch(function (error: unknown) {
        console.warn('[acp/background-turn] 强行让位时收尾失败:', error)
      })
      return
    }
    await waitForTurnEvent(existing, remaining)
  }
}

function spawnBackgroundPump(
  threadID: string,
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
): BackgroundTurn {
  const cancel = new AbortController()
  const turn: BackgroundTurn = {
    threadID,
    events: [],
    dropped: 0,
    status: 'running',
    cancel,
    listeners: new Set(),
    deliveredTerminal: false,
    start,
    persister,
    pendingAppend: [],
    appendScheduled: false,
    appendFlight: Promise.resolve()
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
      // start 正常 return 却无终态：合成一条，禁止订阅方软收尾成「假完成」
      if (!turn.events.some(isTerminalEvent)) {
        console.warn('[acp/background-turn] 泵无终态结束，合成终端事件:', threadID)
        const missing = synthesizeMissingTerminal(cancel.signal)
        dualWriteEvent(turn, missing)
        notifyTurn(turn, missing)
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
      // 终态已在 events 里：立刻标 done（hasRunning / 测试依赖）；Rust finish 仍等 append 排空
      turn.status = 'done'
      clearPersistedRunning(turn.threadID)
      await drainPendingAppend(turn)
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
 * 同一 thread 只允许一轮在跑。`start` 相同 → 复用旧泵（resume 订阅）；
 * `start` 不同 → 先 abort 旧泵再开新泵（编辑 / 重发 / 续跑），禁止静默把新输入接到旧泵。
 */
async function ensureBackgroundTurn(
  threadID: string,
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
): Promise<BackgroundTurn> {
  const existing = turns.get(threadID)
  if (existing && existing.status === 'running') {
    if (existing.start === start) return existing
    await abortBackgroundTurn(threadID)
  }

  return spawnBackgroundPump(threadID, start)
}

/**
 * 订阅（或新建）某 thread 的后台回合：先重放缓冲，再跟实时尾部。
 *
 * UI `detach` / bare abort 只会结束本生成器，**不会**停泵；显式停止（detach===false）
 * 才会 `cancel.abort()`。消费端因用户停止退出时，finally 仍保证泵被 abort。
 */
async function* consumeBackgroundTurn(
  threadID: string,
  uiSignal: AbortSignal | undefined,
  start: (signal: AbortSignal) => AsyncIterable<ChatStreamEvent>
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const turn = await ensureBackgroundTurn(threadID, start)
  const unbind = bindUiCancel(uiSignal, turn.cancel)

  try {
    let index = 0
    let seenDropped = 0
    while (true) {
      const aligned = alignSubscribeIndex(index, seenDropped, turn)
      index = aligned.index
      seenDropped = aligned.seenDropped
      while (index < turn.events.length) {
        const event = turn.events[index]
        index += 1
        if (isTerminalEvent(event)) turn.deliveredTerminal = true
        yield event
        if (isTerminalEvent(event)) return
      }
      if (turn.status === 'done') {
        // 防御：泵标 done 但缓冲仍无终态（竞态 / 旧数据）——再合成一条给 UI
        if (!turn.events.some(isTerminalEvent)) {
          const missing = synthesizeMissingTerminal(turn.cancel.signal)
          turn.deliveredTerminal = true
          yield missing
        }
        return
      }
      // detach / bare abort：立刻给 UI aborted，泵继续跑（resume 续播）。
      // 用户停止：不要抢先 return，等泵把 aborted/finish 推进缓冲。
      if (uiSignal?.aborted && !isUserStopAbort(uiSignal)) {
        yield { kind: 'aborted', usage: {} }
        return
      }
      if (uiSignal?.aborted && isUserStopAbort(uiSignal)) {
        // ui 已 abort：不能再 race waitForUiAbort（会立刻 resolve 忙等）；只等泵事件
        await waitForTurnEvent(turn, 30_000)
        continue
      }
      // notify 可能在挂 listener 前已发：再扫一次，禁止空 wait 冻死「生成中」
      if (index < turn.events.length) continue
      await waitForTurnOrUiAbort(turn, uiSignal)
    }
  } finally {
    const wasUserCancel = Boolean(uiSignal?.aborted && isUserStopAbort(uiSignal))
    unbind()
    // 用户停止：即使 listener 已卸，也要保证泵停掉（编辑/steer 的 abort 可能落在 unbind 后）
    if (
      wasUserCancel &&
      turn.status === 'running' &&
      !turn.cancel.signal.aborted
    ) {
      turn.cancel.abort(uiSignal?.reason)
    }
  }
}

/**
 * Remount / resume 续订。
 *
 * **有本地泵时只扫 `turn.events`**（与 consume 同构）：Nov 3 批写 append 后
 * Rust follow 常落后本地，空批 + waitForTurnEvent 会丢掉已发的 notify → 「生成中」冻死。
 * 仅内存泵已不在时才走 Rust cursor。
 */
async function* followBackgroundTurn(
  threadID: string,
  uiSignal: AbortSignal | undefined
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const local = turns.get(threadID)
  const cancel = local?.cancel ?? new AbortController()
  const unbind = bindUiCancel(uiSignal, cancel)

  try {
    if (local) {
      let index = 0
      let seenDropped = 0
      while (true) {
        const aligned = alignSubscribeIndex(index, seenDropped, local)
        index = aligned.index
        seenDropped = aligned.seenDropped
        while (index < local.events.length) {
          const event = local.events[index]
          index += 1
          if (isTerminalEvent(event)) local.deliveredTerminal = true
          yield event
          if (isTerminalEvent(event)) return
        }
        if (local.status === 'done') {
          if (!local.events.some(isTerminalEvent)) {
            const missing = synthesizeMissingTerminal(local.cancel.signal)
            local.deliveredTerminal = true
            yield missing
          }
          return
        }
        if (uiSignal?.aborted && !isUserStopAbort(uiSignal)) {
          yield { kind: 'aborted', usage: {} }
          return
        }
        if (uiSignal?.aborted && isUserStopAbort(uiSignal)) {
          await waitForTurnEvent(local, 30_000)
          continue
        }
        if (index < local.events.length) continue
        await waitForTurnOrUiAbort(local, uiSignal)
      }
    }

    // 冷路径：WebView 刷新后内存泵没了，跟 Rust ring
    let cursor = 0
    let sawTerminal = false
    while (true) {
      if (uiSignal?.aborted && !isUserStopAbort(uiSignal)) {
        yield { kind: 'aborted', usage: {} }
        return
      }
      const followed = await followAgentTurn(threadID, cursor)
      if (!followed || followed.status === 'missing') {
        if (!sawTerminal) yield synthesizeMissingTerminal(cancel.signal)
        return
      }
      for (const event of followed.events) {
        if (isTerminalEvent(event)) sawTerminal = true
        yield event
        if (isTerminalEvent(event)) return
      }
      cursor = followed.nextCursor
      if (followed.status === 'done') {
        if (!sawTerminal) yield synthesizeMissingTerminal(cancel.signal)
        return
      }
      await Promise.race([waitMs(RUST_FOLLOW_POLL_MS), waitForUiAbort(uiSignal)])
    }
  } finally {
    unbind()
  }
}

/**
 * orphan 落库用：含终态的一侧优先；Rust 缺终态时回落本地镜像，避免丢 finish。
 */
async function findTurnEvents(turn: BackgroundTurn): Promise<ChatStreamEvent[]> {
  const remote = await followAgentTurn(turn.threadID, 0)
  const remoteEvents = remote?.events ?? []
  const localEvents = turn.events
  const remoteHasTerminal = remoteEvents.some(isTerminalEvent)
  const localHasTerminal = localEvents.some(isTerminalEvent)

  if (remoteHasTerminal) return remoteEvents
  if (localHasTerminal) return localEvents
  if (remoteEvents.length > 0) return remoteEvents
  return localEvents
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

/** goose 重置等：中止所有内存态后台泵（并行等待 done） */
async function abortAllBackgroundTurns(): Promise<void> {
  const ids = [...turns.keys()]
  await Promise.all(
    ids.map(function (id) {
      return abortBackgroundTurn(id)
    })
  )
}

export {
  abortAllBackgroundTurns,
  abortBackgroundTurn,
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
  isUserStopAbort,
  onBackgroundTurnFinished,
  pushTurnEvent,
  readRunningTurns,
  syncRunningTurnsFromRust
}
export type { BackgroundTurn }
