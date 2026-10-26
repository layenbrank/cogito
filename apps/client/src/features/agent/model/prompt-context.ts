/**
 * 运行前的提示词上下文：把「模型该知道的运行时事实」集中拼一次。
 *
 * 目前包含：
 * - corex 动作目录的紧凑能力地图（directive / general 场景注入）；
 * - 当前本地时间与时区（plan 场景的相对日期基准）。
 *
 * 不读会话/工作区（Phase 1 的 `features/agent/context/` 再扩展），
 * 避免在 port 层引入对 chat runtime 的依赖。
 */
import { useCorexStore } from '@/stores/corex'

import { buildCapabilitySummary } from './capabilities'
import type { PromptContext } from './prompts'

const CAPABILITY_MAX_CHARS = 6000

function formatLocalNow(date: Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(date)
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
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}

export { CAPABILITY_MAX_CHARS, buildPromptContext, formatLocalNow }
