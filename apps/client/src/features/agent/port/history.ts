/**
 * 历史端口（客户端实现）：会话与消息落到 `stores/agent.ts` 的仓储动作上。
 *
 * 走 store 而不是直接 `invoke`：本地库的写入口只有 store 这一条（乐观更新 + 失败回滚 +
 * `event$` 广播），绕过它会让左栏、用量等订阅方一直读着过期数据 —— 同一条记录两条路，
 * 迟早对不上。
 */
import type { ChatHistoryPort, ChatStoredMessage, ChatThread } from '@cogito/chat/ports'
import dayjs from 'dayjs'
import { v4 as UUIDV4 } from 'uuid'

import { useAgentStore, type Message, type Session } from '@/stores/agent'

function toThread(session: Session): ChatThread {
  return {
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    updatedAt: session.updatedAt,
    providerID: session.providerID,
    workspaceID: session.workspaceID
  }
}

function toStoredMessage(message: Message): ChatStoredMessage {
  return {
    id: message.id,
    parentID: message.parentID,
    format: message.format,
    content: message.content
  }
}

function buildHistoryPort(): ChatHistoryPort {
  function findSession(id: string): Session | null {
    const session = useAgentStore
      .getState()
      .sessions.find(function (item) {
        return item.id === id
      })
    return session ?? null
  }

  /** 会话列表在内存里可能还没水合（刚启动时为空）—— 落库要基于库里的行，先补齐再定位 */
  async function ensureSessionLoaded(id: string): Promise<Session> {
    const cached = findSession(id)
    if (cached) return cached
    await useAgentStore.getState().toReadSessions()
    const session = findSession(id)
    if (!session) throw new Error(`[agent/port] 会话不存在：${id}`)
    return session
  }

  return {
    async findThreads() {
      const sessions = await useAgentStore.getState().toReadSessions()
      return sessions.map(toThread)
    },

    /** 没有单条读接口：列表本身很小，直接从列表里取，避免加一条只为取一的 IPC */
    async findThread(id) {
      const sessions = await useAgentStore.getState().toReadSessions()
      const session = sessions.find(function (item) {
        return item.id === id
      })
      return session ? toThread(session) : null
    },

    async createThread(input) {
      // 调用方没表态时才读「当前工作区」指针（左栏按它归拢会话）。
      // 显式的 `null` 必须保留：那是「不属于任何工作区」，会被 `??` 悄悄改写回当前工作区
      const workspaceID =
        input?.workspaceID === undefined
          ? useAgentStore.getState().activeWorkspaceID
          : input.workspaceID
      const now = Date.now()
      const session: Session = {
        id: UUIDV4(),
        title: input?.title ?? '新对话 ' + dayjs().format('MM-DD HH:mm'),
        pinned: false,
        providerID: input?.providerID ?? null,
        workspaceID,
        createdAt: now,
        updatedAt: now
      }
      await useAgentStore.getState().toWriteSession([session])
      return toThread(session)
    },

    async updateThread(id, patch) {
      await useAgentStore.getState().toUpdateSession([
        {
          id,
          ...(patch.title === undefined ? {} : { title: patch.title }),
          ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
          ...(patch.workspaceID === undefined ? {} : { workspaceID: patch.workspaceID }),
          updatedAt: Date.now()
        }
      ])
      // 以落库后的那一行为准回报（乐观值可能被 store 的合并规则改写）
      return toThread(await ensureSessionLoaded(id))
    },

    async deleteThread(id) {
      await useAgentStore.getState().toRemoveSession([id])
    },

    async findMessages(input) {
      const messages = await useAgentStore.getState().toReadMessages(input.threadID)
      return messages
        .filter(function (message) {
          return message.sessionID === input.threadID
        })
        .map(toStoredMessage)
    },

    async appendMessage(input) {
      const now = Date.now()
      const message: Message = {
        id: input.id,
        content: input.content,
        parentID: input.parentID,
        format: input.format,
        sessionID: input.threadID,
        createdAt: now,
        updatedAt: now
      }
      await useAgentStore.getState().toWriteMessage([message])
    },

    async updateMessage(input) {
      await useAgentStore.getState().toUpdateMessage([
        {
          id: input.id,
          ...(input.format === undefined ? {} : { format: input.format }),
          ...(input.content === undefined ? {} : { content: input.content }),
          updatedAt: Date.now()
        }
      ])
    },

    async deleteMessages(input) {
      await useAgentStore.getState().toRemoveMessage(input.ids)
    }
  }
}

export { buildHistoryPort }
