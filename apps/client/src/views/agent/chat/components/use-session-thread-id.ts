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
import { useAuiState } from '@assistant-ui/react'

function useSessionThreadID(): string | null {
  return useAuiState(function (state) {
    const mainThreadId = state.threads.mainThreadId
    if (!mainThreadId) return null
    const item = state.threads.threadItems.find(function (entry) {
      return entry.id === mainThreadId
    })
    // 还没落库（草稿）时没有 remoteId：退回列表项 id，让调用方照常拿到「有个 id 但没会话」
    return item?.remoteId ?? mainThreadId
  })
}

export { useSessionThreadID }
