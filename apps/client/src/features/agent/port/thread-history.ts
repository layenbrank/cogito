/**
 * 客户端历史适配器：在共享 `createThreadHistoryAdapter` 上挂后台回合 resume。
 *
 * assistant-ui 在 `load()` 后若看到 `unstable_resume`，会调 `resume()` 续跑。
 * detach 留下的「已取消」助手占位要从 load 结果里剥掉，否则 resume 会再挂一条子消息。
 *
 * 有 Tauri 时优先 `agentMessage:loadThread`（JSON 在 Rust 侧解析），失败再回退 TS 解码。
 */
import {
  fromThreadMessageLike,
  type ChatModelRunOptions,
  type ChatModelRunResult,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type ThreadMessageLike
} from '@assistant-ui/react'
import { mapChatStreamToRunResults } from '@cogito/chat/adapters/chat-model'
import {
  createThreadHistoryAdapter,
  LOCAL_FORMAT,
  type ThreadIdentity
} from '@cogito/chat/adapters/thread-history'
import type { ChatHistoryPort, ChatStreamEvent } from '@cogito/chat/ports'
import { invoke } from '@tauri-apps/api/core'
import { v4 as UUIDV4 } from 'uuid'

import {
  bindBackgroundTurnPersister,
  clearPersistedRunning,
  findBackgroundTurn,
  findTurnEvents,
  followBackgroundTurn,
  hasPersistedRunningTurn,
  hasRunningBackgroundTurn,
  isTerminalEvent,
  type BackgroundTurn
} from '@/features/agent/acp/background-turn'
import { markRunFinished, markRunStarted } from '@/features/agent/acp/run-state'
import { resumeThreadRun } from '@/features/agent/acp/session'
import { bindGoalHistoryPort } from '@/features/agent/goal-continue'
import { notifyTurnDone } from '@/features/agent/notify'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

interface StoredLocalPayload {
  role: ThreadMessage['role']
  content: ThreadMessage['content']
  createdAt: string
  status?: ThreadMessage['status']
  metadata?: { custom?: Record<string, unknown> }
}

interface LoadThreadItem {
  parentId: string | null
  message: ThreadMessageLike & { id: string; createdAt?: string | Date }
}

interface LoadThreadR {
  headId: string | null
  messages: LoadThreadItem[]
}

/** Rust 已解码的消息 → assistant-ui ThreadMessage；形状与 `LOCAL_CODEC.decode` 对齐 */
function toThreadMessage(item: LoadThreadItem): { message: ThreadMessage; parentId: string | null } {
  const payload = item.message
  const createdAt =
    payload.createdAt instanceof Date
      ? payload.createdAt
      : typeof payload.createdAt === 'string'
        ? new Date(payload.createdAt)
        : new Date()
  return {
    parentId: item.parentId,
    message: fromThreadMessageLike(
      {
        role: payload.role,
        content: payload.content,
        createdAt,
        ...(payload.status ? { status: payload.status } : {}),
        ...(payload.metadata ? { metadata: payload.metadata } : {})
      },
      payload.id,
      { type: 'complete', reason: 'unknown' }
    )
  }
}

async function fetchThreadViaRust(
  sessionId: string,
  scrubDetach: boolean
): Promise<LoadThreadR | null> {
  try {
    return await invoke<LoadThreadR>(CHANNELS.AGENT_MESSAGE.LOAD_THREAD, {
      params: { sessionId, scrubDetach }
    })
  } catch (error) {
    console.warn('[agent/thread-history] loadThread 不可用，回退 TS 解码:', error)
    return null
  }
}

function isCancelledAssistant(message: ThreadMessage): boolean {
  if (message.role !== 'assistant') return false
  const status = message.status
  if (!status) return false
  if (status.type === 'incomplete' && status.reason === 'cancelled') return true
  if (status.type === 'running') return true
  return false
}

/** 剥掉队尾因 detach 留下的取消/运行中助手，给 resume 腾出干净 head */
function scrubDetachStubs(
  messages: Array<{ message: ThreadMessage; parentId: string | null }>
): Array<{ message: ThreadMessage; parentId: string | null }> {
  const next = [...messages]
  while (next.length > 0) {
    const last = next[next.length - 1]
    if (!isCancelledAssistant(last.message)) break
    next.pop()
  }
  return next
}

function findHeadID(
  messages: Array<{ message: ThreadMessage; parentId: string | null }>
): string | null {
  const parentIDs = new Set(
    messages.map(function (item) {
      return item.parentId
    })
  )
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const id = messages[index].message.id
    if (!parentIDs.has(id)) return id
  }
  return null
}

/** 数组 → AsyncIterable 适配：无真实异步操作，async 仅为匹配 `mapChatStreamToRunResults` 的签名 */
// eslint-disable-next-line @typescript-eslint/require-await
async function* iterateEvents(
  events: readonly ChatStreamEvent[]
): AsyncGenerator<ChatStreamEvent> {
  yield* events
}

/**
 * 后台回合在无 UI 订阅者收终态时补写历史，避免回来只看到 detach 的「已取消」占位。
 */
async function persistOrphanTurn(port: ChatHistoryPort, turn: BackgroundTurn): Promise<void> {
  // 先占坑，避免 finally 补写与 remount load 并发各 append 一条
  if (turn.deliveredTerminal) return
  const events = await findTurnEvents(turn)
  if (!events.some(isTerminalEvent)) return
  turn.deliveredTerminal = true

  try {
    let parentID: string | null = null
    let snapshot: ChatModelRunResult | null = null
    for await (const result of mapChatStreamToRunResults(iterateEvents(events))) {
      snapshot = result
    }
    if (!snapshot) return

    const rows = await port.findMessages({ threadID: turn.threadID })
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index]
      if (row.format !== LOCAL_FORMAT) continue
      try {
        const payload = JSON.parse(row.content) as StoredLocalPayload
        if (payload.role === 'user') {
          parentID = row.id
          break
        }
      } catch (error) {
        console.warn('[agent/thread-history] 跳过无法解码的历史行', row.id, error)
      }
    }

    const status = snapshot.status ?? { type: 'complete' as const, reason: 'unknown' as const }
    const payload: StoredLocalPayload = {
      role: 'assistant',
      content: snapshot.content ?? [],
      createdAt: new Date().toISOString(),
      status,
      ...(snapshot.metadata?.custom ? { metadata: { custom: snapshot.metadata.custom } } : {})
    }

    await port.appendMessage({
      threadID: turn.threadID,
      id: UUIDV4(),
      parentID,
      format: LOCAL_FORMAT,
      content: JSON.stringify(payload)
    })
  } catch (error) {
    reportCaught('agent.background-turn.persist', error, 'warning')
  }
}

function buildThreadHistoryAdapter(
  port: ChatHistoryPort,
  identity: ThreadIdentity
): ThreadHistoryAdapter {
  bindBackgroundTurnPersister(function (turn) {
    return persistOrphanTurn(port, turn)
  })
  // 目标后台续跑要自己写历史（composer 只服务当前线程）
  bindGoalHistoryPort(port)

  const base = createThreadHistoryAdapter(port, identity)

  return {
    async load() {
      const threadID = await identity.resolve()
      const inMemory = threadID ? hasRunningBackgroundTurn(threadID) : false
      // 刷新场景：内存态丢了，但 localStorage / Rust running 记着这轮还在跑（detach 留下的占位是
      // `incomplete/cancelled` 不是 `running`，不能靠消息状态判断）
      const orphanRunning = Boolean(!inMemory && threadID && hasPersistedRunningTurn(threadID))
      const resuming = inMemory || orphanRunning

      if (threadID) {
        const turn = findBackgroundTurn(threadID)
        if (turn && turn.status === 'done' && !turn.deliveredTerminal) {
          await persistOrphanTurn(port, turn)
        }
      }

      // 优先 Rust loadThread（JSON parse / scrub / head 都在主进程）
      if (threadID) {
        const rust = await fetchThreadViaRust(threadID, resuming)
        if (rust) {
          let messages = rust.messages.map(toThreadMessage)
          if (resuming) messages = scrubDetachStubs(messages)
          if (orphanRunning) markRunStarted(threadID)
          return {
            headId: findHeadID(messages) ?? rust.headId,
            messages,
            unstable_resume: resuming
          }
        }
      }

      const repo = await base.load()

      // 刷新的回合不在内存里，但历史说它还在跑 → 先把侧栏运行态点亮
      if (orphanRunning && threadID) {
        markRunStarted(threadID)
      }

      const messages = resuming ? scrubDetachStubs(repo.messages) : repo.messages
      return {
        headId: findHeadID(messages),
        messages,
        unstable_resume: resuming
      }
    },

    async *resume(options: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void, unknown> {
      const threadID =
        (typeof options.unstable_threadId === 'string' && options.unstable_threadId) ||
        (await identity.resolve())
      if (!threadID) return

      try {
        if (hasRunningBackgroundTurn(threadID)) {
          yield* mapChatStreamToRunResults(followBackgroundTurn(threadID, options.abortSignal))
          return
        }
        // 刷新场景：内存缓冲丢了，重新订阅 goose session（session/load 重放历史 + 续尾）
        yield* mapChatStreamToRunResults(resumeThreadRun(threadID, options.abortSignal))
      } finally {
        // 恢复结束（跑完 / 中止）：清掉运行态标记，侧栏停止显示「生成中」
        markRunFinished(threadID)
        clearPersistedRunning(threadID)
        void notifyTurnDone(threadID, options.abortSignal?.aborted === true)
      }
    },

    append(item) {
      return base.append(item)
    },

    async update(item) {
      await base.update?.(item)
    },

    async delete(items) {
      await base.delete?.(items)
    },

    withFormat(formatAdapter) {
      return base.withFormat?.(formatAdapter) as never
    }
  }
}

export { buildThreadHistoryAdapter, scrubDetachStubs }
