import {
  fromThreadMessageLike,
  MessageNotSentError,
  type GenericThreadHistoryAdapter,
  type MessageFormatAdapter,
  type MessageFormatItem,
  type ThreadHistoryAdapter,
  type ThreadMessage,
  type ThreadMessageLike
} from '@assistant-ui/react'

import type { ChatHistoryPort, ChatStoredMessage } from '../ports'

/**
 * 历史适配器：把 `ChatHistoryPort` 接到 assistant-ui runtime。
 *
 * 两种用法共用一个存储：
 * - assistant-ui 的 `useLocalRuntime`：用本包内置格式 `LOCAL_FORMAT`（content 是 JSON 载荷）
 * - 别的 runtime（`useChatRuntime` 等）：走 `withFormat(adapter)`，由调用方的格式适配器编解码
 *
 * 同一条会话**不要**混写两种格式（load 时只认得出自己那种，其余行会被跳过）。
 */

/** `useLocalRuntime` 用的内置消息格式 */
const LOCAL_FORMAT = 'ith/thread-message-like'

/**
 * 内置格式的载荷：只留可 JSON 往返的字段（时间存 ISO 字符串，避免 Date 序列化歧义）。
 * 用 type 而非 interface：`TStorageFormat extends Record<string, unknown>` 需要隐式索引签名。
 *
 * 只落 `metadata.custom`（我们自己的扩展位，目前是用量）：不落它，刷新/切会话后
 * 消息上的用量就没了；assistant-ui 的运行时元数据（steps / timing）不入库。
 */
type LocalPayload = {
  role: ThreadMessageLike['role']
  content: ThreadMessageLike['content']
  createdAt: string
  status?: ThreadMessageLike['status']
  metadata?: { custom?: Record<string, unknown> }
}

const LOCAL_CODEC: MessageFormatAdapter<ThreadMessage, LocalPayload> = {
  format: LOCAL_FORMAT,
  getId(message) {
    return message.id
  },
  encode(item) {
    const { message } = item
    const custom = message.metadata?.custom
    const hasCustom = custom !== undefined && Object.keys(custom).length > 0

    return {
      role: message.role,
      content: message.content as ThreadMessageLike['content'],
      createdAt: message.createdAt.toISOString(),
      ...(message.status ? { status: message.status } : {}),
      ...(hasCustom ? { metadata: { custom } } : {})
    }
  },
  decode(stored) {
    const payload = stored.content
    return {
      parentId: stored.parent_id,
      message: fromThreadMessageLike(
        {
          role: payload.role,
          content: payload.content,
          createdAt: new Date(payload.createdAt),
          ...(payload.status ? { status: payload.status } : {}),
          ...(payload.metadata ? { metadata: payload.metadata } : {})
        },
        stored.id,
        { type: 'complete', reason: 'unknown' }
      )
    }
  }
}

/**
 * 会话身份。会话 id 是**落库后**才存在的：新建线程在 `initialize()` 之前只有本地映射 id
 * （`__LOCALID_x`），而 assistant-ui 在初始化完成的那一刻就可能来写历史。
 *
 * - `resolve()`：读路径。现有会话的权威 id；全新会话（还没落库）返回 null。
 *   **不能**在这里建会话 —— 读历史不该把空会话建出来
 * - `ensure()`：写路径。必须拿到 id，拿不到就抛错（assistant-ui 会吞掉写入失败）
 */
export type ThreadIdentity = {
  resolve(): Promise<string | null>
  ensure(): Promise<string>
}

/**
 * 写路径取会话 id：还没落库就先 `ensure()` 把会话建出来。
 *
 * assistant-ui 会吞掉历史写入的 rejection（`void historyWrite?.catch(() => {})`），
 * 失败在 UI 上完全无感 —— 这里必须留日志，否则"消息凭空消失"查不到任何痕迹。
 */
async function requireThreadID(identity: ThreadIdentity): Promise<string> {
  try {
    return await identity.ensure()
  } catch (error) {
    console.error('[CHAT] 会话 id 解析失败，本条历史写入被丢弃', error)
    throw error
  }
}

/** 分支树的 head：从后往前找第一条"不是任何消息的父节点"的消息 */
function findHeadID<TMessage>(
  items: MessageFormatItem<TMessage>[],
  getId: (message: TMessage) => string
): string | null {
  const parentIDs = new Set(
    items.map(function (item) {
      return item.parentId
    })
  )

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const id = getId(items[index].message)
    if (!parentIDs.has(id)) return id
  }
  return null
}

function parsePayload<TPayload>(row: ChatStoredMessage): TPayload {
  return JSON.parse(row.content) as TPayload
}

/** 指定格式的通用适配器：存储行 ↔ `MessageFormatItem` 的编解码都在这里 */
function createFormattedAdapter<TMessage, TStorageFormat extends Record<string, unknown>>(
  port: ChatHistoryPort,
  identity: ThreadIdentity,
  formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>
): GenericThreadHistoryAdapter<TMessage> {
  function toStoredMessage(item: MessageFormatItem<TMessage>) {
    return {
      id: formatAdapter.getId(item.message),
      parentID: item.parentId,
      format: formatAdapter.format,
      content: JSON.stringify(formatAdapter.encode(item))
    }
  }

  return {
    async load() {
      // 读路径**不能** `ensure()`：读历史不该把空会话建出来（全新会话的 id 还没落库）。
      // 但也不能只看 DOM 层的同步快照 —— 切会话时列表项的状态可能还没发布，
      // 那会让已有会话读成空历史（就是「点开会话什么也没有」）。`resolve()` 负责这两件事。
      const threadID = await identity.resolve()
      if (!threadID) return { headId: null, messages: [] }

      const rows = await port.findMessages({ threadID })
      const items: Array<MessageFormatItem<TMessage>> = []
      for (const row of rows) {
        if (row.format !== formatAdapter.format) continue
        try {
          items.push(
            formatAdapter.decode({
              id: row.id,
              parent_id: row.parentID,
              format: row.format,
              content: parsePayload<TStorageFormat>(row)
            })
          )
        } catch (error) {
          // 一行坏数据（旧版本写下的形状、被截断的 JSON）不该让整条历史作废：
          // 跳过它，后面的消息照常显示
          console.warn('[chat] 跳过一条无法解码的历史消息', row.id, error)
        }
      }

      return { headId: findHeadID(items, formatAdapter.getId), messages: items }
    },

    async append(item) {
      // 新建线程的第一条消息就落在"会话刚建好"这一刻：此时快照可能还是空的，
      // 必须 `ensure()` 拿到落库后的 id，否则外键失败 → 被 assistant-ui 静默吞掉。
      try {
        const threadID = await requireThreadID(identity)
        await port.appendMessage({ threadID, ...toStoredMessage(item) })
      } catch (error) {
        // 写不进去 = 这条消息没发出去。给 assistant-ui 一个 MessageNotSentError，
        // composer 据此把 dispatch 时清掉的草稿还原，用户敲的字不丢。
        // 原始错误已在 requireThreadID / 端口内部留日志，这里只负责换类型。
        throw new MessageNotSentError(
          error instanceof Error ? `消息未能写入历史：${error.message}` : '消息未能写入历史'
        )
      }
    },

    async update(item) {
      // 改的是已存在的消息，会话必然存在；端口也只按消息 id 定位，不需要会话 id
      const stored = toStoredMessage(item)
      await port.updateMessage({
        id: stored.id,
        format: stored.format,
        content: stored.content
      })
    },

    async delete(items) {
      await port.deleteMessages({
        ids: items.map(function (item) {
          return formatAdapter.getId(item.message)
        })
      })
    }
  }
}

/**
 * @param identity 每次调用都重新取当前线程 —— runtime 会在切线程后再读，
 *   不要在构造时捕获线程 id（见 `RemoteThreadListOptions.unstable_useAdapters` 的说明）。
 */
function createThreadHistoryAdapter(
  port: ChatHistoryPort,
  identity: ThreadIdentity
): ThreadHistoryAdapter {
  const local = createFormattedAdapter(port, identity, LOCAL_CODEC)

  return {
    async load() {
      const repository = await local.load()
      return {
        headId: repository.headId ?? null,
        messages: repository.messages.map(function (item) {
          return { message: item.message, parentId: item.parentId }
        })
      }
    },

    async append(item) {
      await local.append({ parentId: item.parentId, message: item.message })
    },

    /** 第二个参数是"本地 id"，用于乐观消息换成服务端 id 的场景（本仓 id 由客户端生成，无需换） */
    async update(item) {
      await local.update?.({ parentId: item.parentId, message: item.message }, item.message.id)
    },

    async delete(items) {
      await local.delete?.(
        items.map(function (item) {
          return { parentId: item.parentId, message: item.message }
        })
      )
    },

    withFormat(formatAdapter) {
      return createFormattedAdapter(port, identity, formatAdapter)
    }
  }
}

export { createThreadHistoryAdapter, LOCAL_FORMAT }
