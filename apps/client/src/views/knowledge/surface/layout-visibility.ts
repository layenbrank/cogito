/**
 * 主区 / 侧栏可见性。
 *
 * 编辑器优先之后不再有「rail-only」形态：设置也是主区里的一个普通页，左侧文档树照常在。
 */import type { AsideTab, RailTabCanonical } from '@/views/knowledge/surface/store.ts'

type RightPaneMode = 'hidden' | 'aside'

/** 主区展示工具页（非 TipTap） */
function isToolMainView(tab: RailTabCanonical): boolean {
  return (
    tab === 'sources' ||
    tab === 'search' ||
    tab === 'graph' ||
    tab === 'lint' ||
    tab === 'review' ||
    tab === 'staging'
  )
}

function findLayoutVisibility(tab: RailTabCanonical): {
  showLeftContent: boolean
  showEditor: boolean
  showToolMain: boolean
} {
  return {
    showLeftContent: true,
    showEditor: tab === 'wiki',
    showToolMain: isToolMainView(tab) || tab === 'settings'
  }
}

/**
 * 右栏（大纲 / AI / 研究）是否展开：它是 Splitter 的第三列（可拖、可折叠），
 * 研究可与工具主区并存，大纲 / AI 仅 Wiki。
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

export { findLayoutVisibility, findRightPaneMode, isToolMainView }
export type { RightPaneMode }

