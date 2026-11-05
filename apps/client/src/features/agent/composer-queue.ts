/**
 * composer 队列的持久化与回灌。
 *
 * 背景：`useLocalRuntime(..., { unstable_enableMessageQueue: true })` 的队列只在
 * 内存里，刷新即丢；库侧 `QueueItemMethods` 只有 `getState / move / remove`，
 * **没有 `edit`**。所以这里做两件事：
 *
 * 1. **落库**：订阅 `composer.queue`，debounce 300ms 后按 `sessionID` 整队替换
 *    （`agentComposerQueue:toReplace`，事务内先删后插）。整队写而不是逐条 diff，
 *    是因为「顺序」才是队列的语义，逐条写几乎必然出现中间态错序。
 * 2. **回灌**：`reconcileComposerQueue` 在 runtime 就绪时读回队列 —— 会话仍在跑就
 *    逐条 `setText` + `send({ steer: false })` 还原成真实队列；会话已结束就放进
 *    `pending` store，由 UI 渲染成「待发送」条，等用户手动触发。
 *
 * 编辑采用「取回式」（对齐 VS Code Copilot Chat）：`remove()` 掉这一条 + 把文本
 * 塞回输入框。只用公开 API，不去 patch 库的 store。
 */
import type { AssistantClient, QueueItemState } from '@assistant-ui/react'
import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'

const QUEUE_DEBOUNCE_MS = 300

/** 库里的行（Rust `Model` 的 camelCase 形态） */
interface ComposerQueueRow {
  id: string
  sessionID: string
  lane: string
  sort: number
  text: string
  attachments: string
  createdAt: number
  updatedAt: number
}

/** 回灌出来的一条「待发送」 */
interface RestoredQueueItem {
  id: string
  text: string
  attachments: string
}

interface ReplaceItem {
  lane: string
  text: string
  attachments: string
}

const EMPTY_PENDING: readonly RestoredQueueItem[] = []

/** 会话级的「待发送」条目（会话已结束、或回灌时不在运行） */
const pendingBySession = new Map<string, RestoredQueueItem[]>()
/** 已经完成 reconcile 的会话：在此之前不允许落库，否则会用空队列把库里的行清掉 */
const readySessions = new Set<string>()
/** 已经回灌过的会话：同一个会话只回灌一次，重挂载不再读库（否则会把旧行再灌一遍） */
const reconciledSessions = new Set<string>()
const inflightReconcile = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

async function invokeCommand<T>(command: string, params: unknown): Promise<T> {
  return invoke<T>(command, { params })
}

async function readComposerQueue(sessionID: string): Promise<ComposerQueueRow[]> {
  const rows = await invokeCommand<ComposerQueueRow[]>('agentComposerQueue:toRead', {
    sessionID
  })
  return Array.isArray(rows) ? rows : []
}

async function replaceComposerQueue(sessionID: string, items: ReplaceItem[]): Promise<void> {
  await invokeCommand<string[]>('agentComposerQueue:toReplace', {
    sessionID,
    lane: null,
    items: items.map(function (item) {
      return { sessionID, lane: item.lane, text: item.text, attachments: item.attachments }
    })
  })
}

function textOfQueueItem(item: QueueItemState): string {
  const parts = item.parts ?? []
  const texts: string[] = []
  for (const part of parts) {
    if (part.type === 'text') texts.push(part.text)
  }
  if (texts.length > 0) return texts.join('')
  return ''
}

function attachmentsOfQueueItem(item: QueueItemState): string {
  const files = (item.parts ?? []).filter(function (part) {
    return part.type === 'file'
  })
  return JSON.stringify(files)
}

function toReplaceItem(item: QueueItemState): ReplaceItem {
  return {
    lane: 'main',
    text: textOfQueueItem(item),
    attachments: attachmentsOfQueueItem(item)
  }
}

function toReplaceItemFromRestored(item: RestoredQueueItem): ReplaceItem {
  return { lane: 'main', text: item.text, attachments: item.attachments }
}

/** 落库：队列 + 待发送，顺序即数组顺序（服务端按下标重排 `sort`） */
async function persistComposerQueue(
  sessionID: string,
  queue: readonly QueueItemState[]
): Promise<void> {
  const pending = pendingBySession.get(sessionID) ?? []
  const items: ReplaceItem[] = []
  for (const item of queue) items.push(toReplaceItem(item))
  for (const item of pending) items.push(toReplaceItemFromRestored(item))
  await replaceComposerQueue(sessionID, items)
}

/**
 * 读回队列并按会话状态决定落到「真实队列」还是「待发送」。
 *
 * 同一个会话只跑一次：`reconciledSessions` 挡住重挂载、`inflightReconcile` 挡住
 * 并发（React 严格模式下两个 effect 几乎同时触发）。回灌两次的后果是队列里出现
 * 两条一模一样的内容，比丢一条更难排查。
 */
function reconcileComposerQueue(
  aui: AssistantClient,
  sessionID: string,
  options: { isRunning: boolean }
): Promise<void> {
  if (reconciledSessions.has(sessionID)) return Promise.resolve()
  const running = inflightReconcile.get(sessionID)
  if (running) return running

  const task = (async function () {
    const rows = await readComposerQueue(sessionID)
    reconciledSessions.add(sessionID)
    if (rows.length === 0) {
      readySessions.add(sessionID)
      return
    }
    if (options.isRunning) {
      for (const row of rows) {
        aui.composer.setText(row.text)
        aui.composer.send({ steer: false })
      }
      pendingBySession.delete(sessionID)
      notify()
    } else {
      pendingBySession.set(
        sessionID,
        rows.map(function (row) {
          return { id: row.id, text: row.text, attachments: row.attachments }
        })
      )
      notify()
    }
    readySessions.add(sessionID)
  })()

  inflightReconcile.set(
    sessionID,
    task.then(
      function () {
        inflightReconcile.delete(sessionID)
      },
      function (error) {
        inflightReconcile.delete(sessionID)
        throw error
      }
    )
  )

  return task
}

function readPendingQueue(sessionID: string | null): readonly RestoredQueueItem[] {
  if (!sessionID) return EMPTY_PENDING
  return pendingBySession.get(sessionID) ?? EMPTY_PENDING
}

function subscribePendingQueue(listener: () => void): () => void {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

/** 把一条「待发送」放回输入框并发送（用户手动触发，或直接丢弃） */
function sendPendingItem(aui: AssistantClient, sessionID: string, id: string): void {
  const items = pendingBySession.get(sessionID)
  const target = items?.find(function (item) {
    return item.id === id
  })
  if (!items || !target) return
  pendingBySession.set(
    sessionID,
    items.filter(function (item) {
      return item.id !== id
    })
  )
  notify()
  aui.composer.setText(target.text)
  aui.composer.send()
}

function dropPendingItem(sessionID: string, id: string): void {
  const items = pendingBySession.get(sessionID)
  if (!items) return
  pendingBySession.set(
    sessionID,
    items.filter(function (item) {
      return item.id !== id
    })
  )
  notify()
}

/** 测试/切会话用：忘掉内存态（不动数据库） */
function resetComposerQueueState(): void {
  pendingBySession.clear()
  readySessions.clear()
  reconciledSessions.clear()
  inflightReconcile.clear()
  notify()
}

/**
 * 订阅 `composer.queue` 并按 threadID 落库。
 *
 * `sessionID` 为空（会话还没落库）时什么都不做：没有 FK 目标写进去也存不住。
 */
function useComposerQueuePersist(
  sessionID: string | null,
  queue: readonly QueueItemState[]
): void {
  const timer = useRef(0)

  useEffect(
    function () {
      if (!sessionID) return
      if (!readySessions.has(sessionID)) return
      if (timer.current !== 0) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(function () {
        timer.current = 0
        void persistComposerQueue(sessionID, queue).catch(function (error: unknown) {
          console.warn('[composer-queue] 落库失败', error)
        })
      }, QUEUE_DEBOUNCE_MS)
      return function () {
        if (timer.current !== 0) window.clearTimeout(timer.current)
      }
    },
    [queue, sessionID]
  )
}

export type { ComposerQueueRow, RestoredQueueItem }
export {
  QUEUE_DEBOUNCE_MS,
  dropPendingItem,
  persistComposerQueue,
  readComposerQueue,
  readPendingQueue,
  reconcileComposerQueue,
  replaceComposerQueue,
  resetComposerQueueState,
  sendPendingItem,
  subscribePendingQueue,
  textOfQueueItem,
  useComposerQueuePersist
}
