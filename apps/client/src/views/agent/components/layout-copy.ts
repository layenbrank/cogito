/**
 * Agent 布局开合文案：按「会话列表 / 对话 / 工作区」说人话，
 * 不提三栏、占满等实现细节。
 */

function findSidebarToggleLabel(isOpen: boolean): string {
  return isOpen ? '隐藏会话列表' : '显示会话列表'
}

function findAsideToggleLabel(isOpen: boolean): string {
  return isOpen ? '隐藏工作区' : '显示工作区'
}

/** 全宽查看文件 / 终端 / 浏览器 */
function findAsideFocusLabel(isFocused: boolean): string {
  return isFocused ? '退出专注' : '专注工作区'
}

const ASIDE_FOCUS_HINT = '放大文件、终端与浏览器，方便查看和调试'

export {
  ASIDE_FOCUS_HINT,
  findAsideFocusLabel,
  findAsideToggleLabel,
  findSidebarToggleLabel
}
