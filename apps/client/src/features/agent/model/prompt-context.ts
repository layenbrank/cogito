/**
 * 运行前的提示词上下文：把「模型该知道的运行时事实」集中拼一次。
 *
 * 目前包含：
 * - corex 动作目录的紧凑能力地图（directive / general 场景注入）；
 * - 当前本地时间与时区（plan 场景的相对日期基准）；
 * - 浏览器面板当前状态（全部标签页 title/url/label）；
 * - 终端会话清单（id / cwd）。
 *
 * 不读会话/工作区（Phase 1 的 `features/agent/context/` 再扩展），
 * 避免在 port 层引入对 chat runtime 的依赖。
 */
import { formatTabTitle } from '@/features/browser/address'
import { useBrowserStore } from '@/features/browser/store'
import { useTerminalStore } from '@/stores/terminal'
import { useCorexStore } from '@/stores/corex'

import { buildCapabilitySummary } from './capabilities'
import type { PromptContext } from './prompts'

const CAPABILITY_MAX_CHARS = 6000
const BROWSER_TAB_LINE_MAX = 12
const TERMINAL_LINE_MAX = 12

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
    browserSummary: summarizeBrowser(),
    terminalSummary: summarizeTerminal()
  }
}

/**
 * 当前浏览器状态：活跃项 + 紧凑全表（未选中 tab 也可按 label 操控）。
 */
function summarizeBrowser(): string {
  const { tabs, activeLabel } = useBrowserStore.getState()
  if (tabs.length === 0) {
    return '浏览器面板现在没有打开的标签页；需要看网页时用 app_browser_open 打开。'
  }
  const active = tabs.find(function (tab) {
    return tab.label === activeLabel
  })
  const head = active
    ? `浏览器面板已打开 ${tabs.length} 个标签页，用户正在看：${formatTabTitle(active.url, active.title)}（${active.url}，label ${active.label}）。`
    : `浏览器面板已打开 ${tabs.length} 个标签页，但没有激活的；读页面时请显式传 tab。`
  const lines = tabs.slice(0, BROWSER_TAB_LINE_MAX).map(function (tab) {
    const mark = tab.label === activeLabel ? '*' : '-'
    return `${mark} ${tab.label} | ${formatTabTitle(tab.url, tab.title)} | ${tab.url}`
  })
  const more =
    tabs.length > BROWSER_TAB_LINE_MAX
      ? `\n…另有 ${tabs.length - BROWSER_TAB_LINE_MAX} 个标签页未列出`
      : ''
  return `${head}\n全部标签（未选中也可 app_browser_* 传 tab）：\n${lines.join('\n')}${more}`
}

/** 嵌入式终端会话清单：agent 与用户 tab 均可 list/read */
function summarizeTerminal(): string {
  const { tabs, activeId } = useTerminalStore.getState()
  if (tabs.length === 0) {
    return '右栏终端目前没有会话；执行命令用 app_terminal_run（按 cwd 复用 agent 会话）。'
  }
  const lines = tabs.slice(0, TERMINAL_LINE_MAX).map(function (tab) {
    const mark = tab.id === activeId ? '*' : '-'
    const kind = tab.id.startsWith('agent:') ? 'agent' : 'user'
    return `${mark} ${tab.id} | ${kind} | cwd ${tab.cwd || '(无)'}`
  })
  const more =
    tabs.length > TERMINAL_LINE_MAX
      ? `\n…另有 ${tabs.length - TERMINAL_LINE_MAX} 个会话未列出`
      : ''
  return `右栏终端已打开 ${tabs.length} 个会话（未选中也可 app_terminal_read / app_terminal_write 传 id）：\n${lines.join('\n')}${more}`
}

export {
  CAPABILITY_MAX_CHARS,
  buildPromptContext,
  formatLocalNow,
  summarizeBrowser,
  summarizeTerminal
}
