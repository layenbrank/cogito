/**
 * 把「当前库说明书」注册给 agent 提示词装配。
 *
 * 为什么放在 bootstrap 而不是知识库视图里：聊天页可能在本次会话里从未打开过知识库，
 * 但用户一开口就在问这个库；说明书（purpose / schema / overview）必须已经在提示里。
 * 读取器按需取当前库，不缓存根路径 —— 切库后下一轮自动换新。
 */
import { registerWikiContextSource } from '@/features/agent/model/prompts'
import { useSpacesStore } from '@/stores/spaces'
import {
  fetchWikiProjectContext,
  formatWikiContextBlock
} from '@/views/knowledge/lib/wiki-context.ts'

function bootstrapWikiContextBridge(): void {
  registerWikiContextSource(async function () {
    const state = useSpacesStore.getState()
    const space = state.spaces.find(function (item) {
      return item.id === state.activeSpaceID
    })
    if (!space) return null
    const context = await fetchWikiProjectContext(space.rootPath)
    return formatWikiContextBlock(context)
  })
}

export { bootstrapWikiContextBridge }
