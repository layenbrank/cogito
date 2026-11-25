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
 *    `pending` store，由 UI 渲染成「待发送」条，**本轮结束后自动补发**（`pumpPendingQueue`）。
 *
 * 编辑采用「取回式」（对齐 VS Code Copilot Chat）：`remove()` 掉这一条 + 把文本
 * 塞回输入框。只用公开 API，不去 patch 库的 store。
 */
import type {
  AssistantClient,
  Attachment,
  QueueItemState,
  ThreadUserMessagePart
} from '@assistant-ui/react'
import { useEffect, useRef } from 'react'

import { GET_AGENT_COMPOSER_QUEUE, PUT_AGENT_COMPOSER_QUEUE } from '@/apis/agent-runtime'

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

/**
 * 队列条目里除正文之外的部分：图片（`image` part，data URL）与文件（`file` part）。
 *
 * 形状沿用 assistant-ui 的 message part，原样落库：回灌时把它原样塞回
 * `composer.addAttachment({ content })`，不在这里做归一化，免得两套形状对不上。
 */
interface QueueAttachment {
  type: string
  filename?: string
  mimeType?: string
  /** `image` part：data URL */
  image?: string
  /** `file` part：内容（工作区引用是空串，真身靠 `filename` 指路） */
  data?: string
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

async function readComposerQueue(sessionID: string): Promise<ComposerQueueRow[]> {
  const rows = await GET_AGENT_COMPOSER_QUEUE<ComposerQueueRow[]>(sessionID)
  return Array.isArray(rows) ? rows : []
}

async function replaceComposerQueue(sessionID: string, items: ReplaceItem[]): Promise<void> {
  await PUT_AGENT_COMPOSER_QUEUE({
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

/**
 * 队列条目的附件 → JSON 字符串。
 *
 * 以前只挑 `type === 'file'`：粘贴 / 截图进来的图片在队列里是 `image` part，
 * 整类被丢掉 —— 用户看到的就是「一排进队列，图片就没了」。文本以外的部分全都留下。
 */
function queueItemAttachments(item: QueueItemState): QueueAttachment[] {
  return (item.parts ?? []).filter(function (part) {
    return part.type !== 'text'
  })
}

function attachmentsOfQueueItem(item: QueueItemState): string {
  return JSON.stringify(queueItemAttachments(item))
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

/** 落库的附件 JSON → part 列表；坏数据当没有，不要因为一行脏 JSON 让整队回灌失败 */
function parseQueueAttachments(attachments: string | null | undefined): QueueAttachment[] {
  if (!attachments) return []
  try {
    const parsed: unknown = JSON.parse(attachments)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (part): part is QueueAttachment {
      return (
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { type?: unknown }).type === 'string' &&
        (part as { type: string }).type !== 'text'
      )
    })
  } catch (error) {
    console.warn('[composer-queue] 附件 JSON 解析失败', error)
    return []
  }
}

/** 一条附件的人话名字：图片没文件名时给「图片」，别在 UI 上留空白 */
function queueAttachmentLabel(part: QueueAttachment): string {
  if (part.filename) return part.filename
  return part.type === 'image' ? '图片' : '附件'
}

/**
 * 把附件挂回 composer。
 *
 * 只用公开入口 `addAttachment({ content })`：`content` 就是队列里存的那些 part，
 * 原样还回去，图片的 data URL 与工作区引用的 `filename` 都不会变形。
 */
async function addQueueAttachments(
  aui: AssistantClient,
  parts: readonly QueueAttachment[]
): Promise<void> {
  for (const part of parts) {
    try {
      await aui.composer.addAttachment({
        type: part.type === 'image' ? 'image' : 'file',
        name: queueAttachmentLabel(part),
        ...(part.mimeType ? { contentType: part.mimeType } : {}),
        content: [part as unknown as ThreadUserMessagePart]
      })
    } catch (error) {
      // 一个附件挂不上不该连累整条消息：正文照发，缺的那张在日志里能查到
      console.warn('[composer-queue] 附件还原失败', error)
    }
  }
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
      // 回灌成真实队列：逐条「挂附件 + 正文 + send({ steer: false })」。
      // 输入框里可能正写着下一句、也可能挂着图 —— 由 `sendQueueEntry` 负责让位与还原。
      const leftovers: RestoredQueueItem[] = []
      for (const row of rows) {
        const entry = { text: row.text, parts: parseQueueAttachments(row.attachments) }
        // 被闸门挡下 = 这条没进队列：改放「待发送」，别丢（附件跟着一起留着）
        if (!(await sendQueueEntry(aui, entry, { steer: false }))) {
          leftovers.push({ id: row.id, text: row.text, attachments: row.attachments })
        }
      }
      if (leftovers.length > 0) pendingBySession.set(sessionID, leftovers)
      else pendingBySession.delete(sessionID)
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

/** 同会话的补发锁：一条发出去、线程进入运行之前，别再发第二条 */
const pumpArmed = new Map<string, boolean>()

/** 线程真的跑起来了：下一件「待发送」现在可以放行 */
function markThreadRunning(sessionID: string): void {
  pumpArmed.set(sessionID, true)
}

/** 用户此刻在输入框里攒着的东西：正文 + 附件，发完要原样放回去 */
interface ComposerDraft {
  text: string
  attachments: readonly Attachment[]
}

function readComposerDraft(aui: AssistantClient): ComposerDraft {
  const state = aui.composer.getState()
  return { text: state.text, attachments: state.attachments ?? [] }
}

/** 草稿附件挂回去：有 `content` 就按 content 还原，没有的退回原始 File */
async function reattachDraftAttachments(
  aui: AssistantClient,
  attachments: readonly Attachment[]
): Promise<void> {
  for (const attachment of attachments) {
    try {
      const content = attachment.content
      if (content && content.length > 0) {
        await aui.composer.addAttachment({
          type: attachment.type,
          name: attachment.name,
          ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
          content: [...content]
        })
        continue
      }
      if (attachment.file) await aui.composer.addAttachment(attachment.file)
    } catch (error) {
      console.warn('[composer-queue] 草稿附件恢复失败', error)
    }
  }
}

/**
 * 发一条队列条目（正文 + 附件），但**不动用户手里的草稿**。
 *
 * 补发历史队列时，输入框里往往正写着下一句、甚至已经挂了几张图：`setText` 覆盖它
 * 再 `send()` 会把草稿一起发出去；而 `send()` 发的是 composer 当前的全部附件，
 * 所以草稿附件必须先摘下来，发完再挂回去 —— 否则它们会粘到这条补发的消息上。
 *
 * 返回是否真的发出去了：`send()` 在 `!canSend` 时**静默返回**（不抛错），
 * 这时正文还留在输入框里 —— 调用方不要把这条从队列里摘掉。
 */
async function sendQueueEntry(
  aui: AssistantClient,
  entry: { text: string; parts: readonly QueueAttachment[] },
  options?: { steer?: boolean }
): Promise<boolean> {
  const draft = readComposerDraft(aui)
  aui.composer.setText(entry.text)
  if (draft.attachments.length > 0) await aui.composer.clearAttachments()
  await addQueueAttachments(aui, entry.parts)
  aui.composer.send(options)
  // 发出去的话正文已被清空；还是原文 = 被闸门挡下（thread 未启用 / 正在提交）
  const accepted = aui.composer.getState().text !== entry.text
  // `send()` 同步清空正文：草稿必须紧跟其后写回，晚一拍会被当成新的输入
  if (draft.text.length > 0) aui.composer.setText(draft.text)
  // 附件是异步的：我们挂上去的、草稿自己的，一律清掉再按草稿还原
  if (entry.parts.length > 0 || draft.attachments.length > 0) {
    if (aui.composer.getState().attachments.length > 0) await aui.composer.clearAttachments()
    await reattachDraftAttachments(aui, draft.attachments)
  }
  return accepted
}

/** 把一条「待发送」发出去（用户手动触发，或由补发泵触发） */
async function sendPendingItem(
  aui: AssistantClient,
  sessionID: string,
  id: string
): Promise<boolean> {
  const items = pendingBySession.get(sessionID)
  const target = items?.find(function (item) {
    return item.id === id
  })
  if (!items || !target) return false
  // 先发、成功才播掉：以前先删再发，一旦被拒（没模型 / 线程未启用）这条就凭空消失了
  const entry = { text: target.text, parts: parseQueueAttachments(target.attachments) }
  if (!(await sendQueueEntry(aui, entry))) return false
  pendingBySession.set(
    sessionID,
    items.filter(function (item) {
      return item.id !== id
    })
  )
  notify()
  return true
}

/**
 * 自走泵：本轮结束时把队首的那条「待发送」发出去。
 *
 * 以前 UI 上一直写着「本轮结束后自动发送」，实际没有任何代码去发 ——
 * 用户看到承诺、等不到消息。现在每轮结束发一条，发完线程重新进入运行；
 * 下一轮结束时再发下一条，队列就这样自己走完（`markThreadRunning` 负责放行）。
 */
/** 正在补发的会话：附件挂载是异步的，别让同一会话的两条补发挤进来的 */
const pumpingSessions = new Set<string>()

async function pumpPendingQueue(aui: AssistantClient, sessionID: string): Promise<boolean> {
  if (aui.thread.getState().isRunning) return false
  if (pumpArmed.get(sessionID) === false) return false
  if (pumpingSessions.has(sessionID)) return false
  const head = pendingBySession.get(sessionID)?.[0]
  if (!head) return false
  pumpingSessions.add(sessionID)
  try {
    const sent = await sendPendingItem(aui, sessionID, head.id)
    // 真发出去了才等线程跑起来（markThreadRunning）再放下一条；被拒时保持放行，
    // 用户把入口修好（启用对话 / 选模型）后还能接着补
    if (sent) pumpArmed.set(sessionID, false)
    return sent
  } finally {
    pumpingSessions.delete(sessionID)
  }
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

/** 上下移动一条「待发送」；顺序会被下一次落库原样写回（数组顺序即 `sort`） */
function movePendingItem(sessionID: string, id: string, direction: -1 | 1): boolean {
  const items = pendingBySession.get(sessionID)
  if (!items || items.length < 2) return false
  const index = items.findIndex(function (item) {
    return item.id === id
  })
  const target = index + direction
  if (index < 0 || target < 0 || target >= items.length) return false
  const next = items.slice()
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  pendingBySession.set(sessionID, next)
  notify()
  return true
}

/** 测试/切会话用：忘掉内存态（不动数据库） */
function resetComposerQueueState(): void {
  pendingBySession.clear()
  readySessions.clear()
  reconciledSessions.clear()
  inflightReconcile.clear()
  pumpArmed.clear()
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

export type { ComposerQueueRow, QueueAttachment, RestoredQueueItem }
export {
  QUEUE_DEBOUNCE_MS,
  addQueueAttachments,
  dropPendingItem,
  markThreadRunning,
  movePendingItem,
  parseQueueAttachments,
  persistComposerQueue,
  queueItemAttachments,
  pumpPendingQueue,
  queueAttachmentLabel,
  readComposerQueue,
  readPendingQueue,
  reconcileComposerQueue,
  replaceComposerQueue,
  resetComposerQueueState,
  sendPendingItem,
  sendQueueEntry,
  subscribePendingQueue,
  textOfQueueItem,
  useComposerQueuePersist
}
