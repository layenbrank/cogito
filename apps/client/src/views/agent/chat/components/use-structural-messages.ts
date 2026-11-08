/**
 * 按「结构」订阅线程消息。
 *
 * assistant-ui 的 `thread.messages` 在流式时**逐 token** 换引用（正文在长）。
 * 但很多消费方根本不看正文：工具路径、计划条目、附件来源、审阅行 —— 它们只随
 * 「消息条数 / part 类型 / 工具调用状态 / 附件」变化。
 *
 * 直接 `useAuiState(s => s.thread.messages)` 会让整块面板每帧重渲染（详情面板 1200 行、
 * composer footer 常驻），再把 O(消息数) 的投影重算一遍。这里把订阅面收窄成一个结构指纹：
 * 指纹不变 → React 拿到同一个字符串 → 不重渲染。
 *
 * 需要**逐 token** 读正文的地方（如右栏「计划草稿」预览）不要用这个钩子，
 * 让那一小块自己订阅 `state.thread.messages`。
 */
import { useAui, useAuiState } from '@assistant-ui/react'
import type { ThreadMessage } from '@assistant-ui/react'
import { useMemo } from 'react'

/**
 * 结构指纹：消息 id / 角色 / part 数量 / part 类型 / 工具调用状态 / 附件名。
 *
 * 刻意**不含正文长度**：流式正文增长被排除在外，正是这个钩子的意义。
 * `result === undefined` 只取布尔，不序列化结果本身（工具结果可能有几 MB）。
 */
function threadStructureKey(messages: readonly ThreadMessage[]): string {
  const chunks: string[] = [String(messages.length)]
  for (const message of messages) {
    chunks.push(`${message.id}:${message.role}:${message.content.length}`)
    for (const part of message.content) {
      if (part.type === 'tool-call') {
        // `status` 在 assistant-ui 的联合类型里是条件类型，按结构取一下更稳
        const rawStatus = (part as { status?: { type?: unknown } }).status
        const statusType = typeof rawStatus?.type === 'string' ? rawStatus.type : ''
        chunks.push(
          `t:${part.toolCallId}:${part.toolName}:${statusType}:${
            part.result === undefined ? 0 : 1
          }`
        )
        continue
      }
      if (part.type === 'file' || part.type === 'image' || part.type === 'audio') {
        chunks.push(`${part.type}:${String('filename' in part ? (part.filename ?? '') : '')}`)
        continue
      }
      chunks.push(part.type)
    }
  }
  return chunks.join('|')
}

function useStructuralThreadMessages(): readonly ThreadMessage[] {
  const aui = useAui()
  const key = useAuiState(function (state) {
    return threadStructureKey(state.thread.messages)
  })

  return useMemo(
    function () {
      // `key` 只当缓存键：结构没变就复用上次那份快照，别把新数组传下去
      void key
      return aui.thread.getState().messages
    },
    [aui, key]
  )
}

export { threadStructureKey, useStructuralThreadMessages }
