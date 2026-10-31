/**
 * 运行前的提示词上下文：把「模型该知道的运行时事实」集中拼一次。
 *
 * 目前包含：
 * - corex 动作目录的紧凑能力地图（directive / general 场景注入）；
 * - 当前本地时间与时区（plan 场景的相对日期基准）；
 * - 浏览器面板当前状态（有没有开着的标签页、在看哪个地址）。
 *
 * 不读会话/工作区（Phase 1 的 `features/agent/context/` 再扩展），
 * 避免在 port 层引入对 chat runtime 的依赖。
 */
import { useBrowserStore } from '@/features/browser/store'
import { useCorexStore } from '@/stores/corex'

import { buildCapabilitySummary } from './capabilities'
import type { PromptContext } from './prompts'

const CAPABILITY_MAX_CHARS = 6000

const LOCAL_NOW_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'full',
  timeStyle: 'short'
})

function formatLocalNow(date: Date): string {
  try {
    return LOCAL_NOW_FORMATTER.format(date)
  } catch (error) {
    console.warn('[agent/prompt] 本地时间格式化失败，退回 ISO:', error)
    return date.toISOString()
  }
}

function buildPromptContext(): PromptContext {
  const actions = useCorexStore.getState().catalog
  const summary = buildCapabilitySummary(actions, { maxChars: CAPABILITY_MAX_CHARS })
  return {
    capabilitySummary: summary.text,
    now: formatLocalNow(new Date()),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    browserSummary: summarizeBrowser()
  }
}

/**
 * 当前浏览器状态。
 *
 * 不传就没有这行，模型只能靠“要有浏览器”这句话去试；传了它就知道**已经有页面开着**，
 * 可以直接读，而不必先 open 一样。
 */
function summarizeBrowser(): string {
  const { tabs, activeLabel } = useBrowserStore.getState()
  if (tabs.length === 0) {
    return '浏览器面板现在没有打开的标签页；需要看网页时用 app_browser_open 打开。'
  }
  const active = tabs.find(function (tab) {
    return tab.label === activeLabel
  })
  if (!active) {
    return `浏览器面板已打开 ${tabs.length} 个标签页，但没有激活的；读页面时请显式传 tab。`
  }
  return `浏览器面板已打开 ${tabs.length} 个标签页，用户正在看：${active.url}（label ${active.label}）。`
}

export { CAPABILITY_MAX_CHARS, buildPromptContext, formatLocalNow }
