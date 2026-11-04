/**
 * 对齐 llm_wiki 可见性 + cogito 右栏（大纲 | AI | 深度研究 同一 Splitter 列）：
 * - 设置：全宽主区，左内容栏收起
 * - 深度研究页签：非设置/专注下可与工具主区并存
 * - 大纲 / AI：仅 Wiki 主区时展开右栏
 */
import type { AsideTab, RailTabCanonical } from '@/views/knowledge/surface/store.ts'

type RightPaneMode = 'hidden' | 'aside'

/** 主区独占、收起左内容栏（与 llm_wiki settings 同级） */
function isRailOnlyView(tab: RailTabCanonical): boolean {
  return tab === 'settings'
}

/** 主区展示工具页（非 TipTap）；左栏仍显示 Knowledge|Files */
function isToolMainView(tab: RailTabCanonical): boolean {
  return (
    tab === 'sources' ||
    tab === 'search' ||
    tab === 'graph' ||
    tab === 'lint' ||
    tab === 'review'
  )
}

function findLayoutVisibility(tab: RailTabCanonical): {
  isRailOnly: boolean
  showLeftContent: boolean
  showEditor: boolean
  showToolMain: boolean
} {
  const isRailOnly = isRailOnlyView(tab)
  const showToolMain = isToolMainView(tab) || isRailOnly
  return {
    isRailOnly,
    showLeftContent: !isRailOnly,
    showEditor: tab === 'wiki',
    showToolMain
  }
}

/**
 * 右栏是否展开：研究可与工具主区并存；大纲/AI 仅 Wiki。
 */
function findRightPaneMode(input: {
  tab: RailTabCanonical
  asideTab: AsideTab
  isAsideOpen: boolean
  isFocusMode: boolean
}): RightPaneMode {
  if (input.isFocusMode || input.tab === 'settings') return 'hidden'
  if (!input.isAsideOpen) return 'hidden'
  if (input.asideTab === 'research') return 'aside'
  if (input.tab === 'wiki') return 'aside'
  return 'hidden'
}

export {
  findLayoutVisibility,
  findRightPaneMode,
  isRailOnlyView,
  isToolMainView
}
export type { RightPaneMode }
