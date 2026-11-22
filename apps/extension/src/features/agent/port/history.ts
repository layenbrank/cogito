/**
 * 会话历史端口（扩展实现）：Dexie 上的 `ChatHistoryPort`。
 *
 * 与 client 的差别只在落点（client 走 SQLite + Tauri 命令），契约完全一样 ——
 * 这是 `@cogito/chat` 当初把端口抽出来的目的，扩展不必再发明一套历史模型。
 *
 * ## 两个必须守住的细节
 *
 * 1. **消息顺序**：`ChatStoredMessage` 里没有时间字段（列名是被钉死的存储契约），
 *    所以顺序靠自增 `seq`。用 `createdAt` 排序会在同一毫秒内乱序 —— 用户消息与
 *    紧随其后的助手消息常常就是同一毫秒。
 * 2. **级联删除**：只删调用方点名的 id，不做「删父节点连带整棵子树」的猜测。
 *    assistant-ui 传进来的就是它要删的那几条，替它推断会把用户没选的分支一起删掉。
 */

import { NEW_THREAD_TITLE } from '@cogito/chat/adapters/thread-list'
import type { ChatHistoryPort, ChatStoredMessage, ChatThread } from '@cogito/chat/ports'

import { database } from '@/database/database.ts'
import type { AgentThreadRow } from '@/database/database.ts'

function toThread(row: AgentThreadRow): ChatThread {
  return {
    id: row.id,
    title: row.title,
    pinned: row.pinned,
    updatedAt: row.updatedAt,
    providerID: row.providerID,
    workspaceID: row.workspaceID
  }
}

/** 置顶优先、最近活动在前 */
function compareThreads(left: ChatThread, right: ChatThread): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1
  return right.updatedAt - left.updatedAt
}

function buildDexieHistoryPort(): ChatHistoryPort {
  return {
    async findThreads(): Promise<ChatThread[]> {
      const rows = await database.agentThread.toArray()
      return rows.map(toThread).sort(compareThreads)
    },

    async findThread(id: string): Promise<ChatThread | null> {
      const row = await database.agentThread.get(id)
      return row ? toThread(row) : null
    },

    async createThread(input): Promise<ChatThread> {
      const now = Date.now()
      const row: AgentThreadRow = {
        id: crypto.randomUUID(),
        title: input?.title?.trim() || NEW_THREAD_TITLE,
        pinned: false,
        providerID: input?.providerID ?? null,
        workspaceID: input?.workspaceID ?? null,
        lastSeq: 0,
        acpSessionID: null,
        createdAt: now,
        updatedAt: now
      }
      await database.agentThread.add(row)
      return toThread(row)
    },

    async updateThread(id, patch): Promise<ChatThread> {
      const current = await database.agentThread.get(id)
      if (!current) throw new Error(`会话不存在：${id}`)
      const next: AgentThreadRow = {
        ...current,
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        ...(patch.workspaceID === undefined ? {} : { workspaceID: patch.workspaceID }),
        updatedAt: Date.now()
      }
      await database.agentThread.put(next)
      return toThread(next)
    },

    async deleteThread(id: string): Promise<void> {
      await database.transaction('rw', database.agentThread, database.agentMessage, async function () {
        await database.agentMessage.where('threadID').equals(id).delete()
        await database.agentThread.delete(id)
      })
    },

    async findMessages(input): Promise<ChatStoredMessage[]> {
      const rows = await database.agentMessage
        .where('threadID')
        .equals(input.threadID)
        .sortBy('seq')
      return rows.map(function (row) {
        return { id: row.id, parentID: row.parentID, format: row.format, content: row.content }
      })
    },

    async appendMessage(input): Promise<void> {
      await database.agentMessage.add({
        id: input.id,
        threadID: input.threadID,
        parentID: input.parentID,
        format: input.format,
        content: input.content
      })
      // 活跃时间跟着新消息走：会话列表按它排「最近活动」，不更新的话发了消息列表也不动
      await database.agentThread
        .where('id')
        .equals(input.threadID)
        .modify({ updatedAt: Date.now() })
    },

    async updateMessage(input): Promise<void> {
      const patch: { format?: string; content?: string } = {}
      if (input.format !== undefined) patch.format = input.format
      if (input.content !== undefined) patch.content = input.content
      if (Object.keys(patch).length === 0) return
      await database.agentMessage.where('id').equals(input.id).modify(patch)
    },

    async deleteMessages(input): Promise<void> {
      if (input.ids.length === 0) return
      await database.agentMessage.where('id').anyOf(input.ids).delete()
    }
  }
}

export { buildDexieHistoryPort, compareThreads, toThread }
