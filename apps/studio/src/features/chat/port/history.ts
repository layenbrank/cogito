import type { ChatHistoryPort, ChatStoredMessage, ChatThread } from '@cogito/chat/ports'

import { useAgentStore } from '@/stores/agent.ts'

/**
 * 历史端口（渲染进程实现）：直接映射 `itc.chat.*` 仓储 API。
 *
 * 数据在主进程独占（better-sqlite3），渲染进程只经 IPC 读写；
 * 时间在 IPC 上是 ISO 字符串，这里换回 epoch ms（端口约定）。
 */

type SessionReadR = Awaited<ReturnType<typeof itc.chat.session.toRead>>[number]
type MessageReadR = Awaited<ReturnType<typeof itc.chat.message.toRead>>[number]

function toThread(session: SessionReadR): ChatThread {
  return {
    id: session.id,
    title: session.title,
    pinned: session.pinned,
    updatedAt: Date.parse(session.updatedAt),
    providerID: session.providerID,
    workspaceID: session.workspaceID
  }
}

/**
 * 新建会话归属当前工作区（左栏按它归拢会话）。
 * 指针本身已由 `useActiveWorkspaceID` 自愈，所以这里直接读 agent 存储即可。
 */
function findActiveWorkspaceID(): string | null {
  return useAgentStore.getState().settings.workspace.activeWorkspaceID
}

function toStoredMessage(message: MessageReadR): ChatStoredMessage {
  return {
    id: message.id,
    parentID: message.parentID,
    format: message.format,
    content: message.content
  }
}

function createHistoryPort(): ChatHistoryPort {
  return {
    async findThreads() {
      const sessions = await itc.chat.session.toRead()
      return sessions.map(toThread)
    },

    /** 没有单条读接口：列表本身很小，直接从列表里取，避免加一条只为取一的 IPC */
    async findThread(id) {
      const sessions = await itc.chat.session.toRead()
      const session = sessions.find(function (item) {
        return item.id === id
      })
      return session ? toThread(session) : null
    },

    async createThread(input) {
      // 存储是异步水合的（`initialize()`），没等它就读指针只会读到 null：
      // 会话于是挂到"当前工作区"的兜底值上，用户在新会话里找不到自己刚建的那个。
      // `initialize()` 幂等，已水合时是一次同步返回。
      if (!input?.workspaceID) await useAgentStore.getState().initialize()
      const session = await itc.chat.session.toWrite({
        ...(input?.title ? { title: input.title } : {}),
        providerID: input?.providerID ?? null,
        workspaceID: input?.workspaceID ?? findActiveWorkspaceID()
      })
      return toThread(session)
    },

    async updateThread(id, patch) {
      const session = await itc.chat.session.toUpdate({
        id,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        ...(patch.workspaceID === undefined ? {} : { workspaceID: patch.workspaceID })
      })
      return toThread(session)
    },

    async deleteThread(id) {
      await itc.chat.session.toRemove({ id })
    },

    async findMessages(input) {
      const messages = await itc.chat.message.toRead({ sessionID: input.threadID })
      return messages.map(toStoredMessage)
    },

    async appendMessage(input) {
      await itc.chat.message.toAppend({
        id: input.id,
        sessionID: input.threadID,
        parentID: input.parentID,
        format: input.format,
        content: input.content
      })
    },

    async updateMessage(input) {
      await itc.chat.message.toUpdate({
        id: input.id,
        ...(input.format === undefined ? {} : { format: input.format }),
        ...(input.content === undefined ? {} : { content: input.content })
      })
    },

    /** 逐条删：主进程侧按 parentID 级联删除后继分支 */
    async deleteMessages(input) {
      for (const id of input.ids) {
        await itc.chat.message.toRemove({ id })
      }
    }
  }
}

export { createHistoryPort }
