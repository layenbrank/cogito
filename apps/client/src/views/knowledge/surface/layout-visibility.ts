/**
 * 对齐 llm_wiki `app-layout-visibility`：
 * - 设置：全宽主区，左内容栏收起（只留 icon rail）
 * - Wiki：左栏 Knowledge|Files + 活动条，主区编辑器
 * - 来源 / 检索 / 图谱 / Lint / 审阅 / 研究 / 活动：主区工具视图，左栏仍可浏览
 */
import type { RailTabCanonical } from '@/views/knowledge/surface/store.ts'

/** 主区独占、收起左内容栏（与 llm_wiki settings/chat/skills 同级） */
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
    tab === 'review' ||
    tab === 'research' ||
    tab === 'activity'
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

export { findLayoutVisibility, isRailOnlyView, isToolMainView }
