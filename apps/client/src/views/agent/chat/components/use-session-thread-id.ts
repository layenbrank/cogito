/**
 * 当前会话的**库内会话 id**。
 *
 * assistant-ui 的 `threads.mainThreadId` 是**列表项 id**：新会话在落库前是
 * `__LOCALID_…` 这类草稿 id，落库后库里那一行才是 `remoteId`。而 ACP session 登记、
 * goose 用量、手动压缩全都按库内 id 走（`runThreadPrompt` 拿的就是 `identity.ensure()`
 * 解析出的 remoteId）。
 *
 * 直接把 mainThreadId 交给 `hasThreadSession` / `compactThreadSession` 的后果是静默的：
 * 压缩按钮永远灰着、点了回一句「当前对话尚无 goose session」，用量也读成 0 ——
 * 看起来像功能没做，其实是 id 对不上。这里统一折一次。
 */
import { useAuiState, type AssistantState } from '@assistant-ui/react'

/** `threads` 作用域里折算库内 id 需要的两个字段（hook 与 `aui.threads.getState()` 都有） */
interface ThreadListLike {
  readonly mainThreadId: string
  readonly threadItems: ReadonlyArray<{ readonly id: string; readonly remoteId?: string }>
}

/**
 * 当前会话的**库内** id；草稿阶段（还没落库）返回 null。
 *
 * 偏好 / 档案 / 审批档的**持久化键**必须用它：`mainThreadId` 是列表项 id（草稿期是
 * `__LOCALID_…`），落库后不会变成库内 id。写进草稿 id 的行重启后永远读不回来。
 *
 * 草稿期**不**退回列表项 id：调用方全都用 `if (!threadID) return` 表达「还没有会话」，
 * 退回草稿 id 等于让它们照常写进一个没人读的键。
 */
function findSessionKey(threads: ThreadListLike): string | null {
  if (!threads.mainThreadId) return null
  const item = threads.threadItems.find(function (entry) {
    return entry.id === threads.mainThreadId
  })
  return item?.remoteId ?? null
}

function findSessionID(state: AssistantState): string | null {
  return findSessionKey(state.threads)
}

function useResolvedSessionID(): string | null {
  return useAuiState(findSessionID)
}

function useSessionThreadID(): string | null {
  return useAuiState(findSessionID)
}

export { findSessionKey, useResolvedSessionID, useSessionThreadID }
