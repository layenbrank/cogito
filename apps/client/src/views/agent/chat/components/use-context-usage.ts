/**
 * 上下文用量快照：composer 气泡（概览）与右栏「上下文」面板（明细）共用一份口径。
 *
 * 两边数字必须一致 —— 气泡说「工具占 60%」、面板说「58%」，用户只会理解为都不准。
 * 估算挂在常驻组件上，所以先按结构订阅、再 200ms 节流（见 `use-structural-messages`）。
 */
import type { ModelUsageBreakdown } from '@cogito/design/assistant/context'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'

import {
  findGooseUsage,
  formatGooseUsage,
  formatTokenCount,
  subscribeGooseUsage,
  type GooseUsage
} from '@/features/agent/acp/goose-usage'
import {
  contextLevelOf,
  splitContextSegments,
  type ContextLevel,
  type ContextSegment
} from '@/features/agent/context-breakdown'
import {
  estimateContextBreakdown,
  rankMessagesByTokens,
  type ContextMessageCost
} from '@/features/agent/context-estimate'
import { FALLBACK_MAX_TOKENS, pickContextWindow } from '@/features/agent/context-window'
import type { ContextWindowSource } from '@/features/agent/context-window'
import { findModelPref } from '@/features/agent/model/model-prefs'
import { appendModeGuidance, readAgentMode, subscribeAgentMode } from '@/features/agent/mode'
import { findActiveScenario } from '@/features/agent/model/active-scenario'
import { buildPromptContext } from '@/features/agent/model/prompt-context'
import { findSystemPrompt } from '@/features/agent/model/prompts'
import { useProviderStore } from '@/stores/provider'

import { useSessionThreadID } from './use-session-thread-id'
import { useStructuralThreadMessages } from './use-structural-messages.ts'

interface ContextUsageSnapshot {
  usage: GooseUsage | null
  /** 已用（优先会话统计，没有就是 0） */
  used: number
  /** 窗口上限（会话统计为准；模型偏好里调高时以偏好为准） */
  max: number
  /** 这个分母是哪来的：goose 统计 / 模型偏好 / 兜底 */
  windowSource: ContextWindowSource
  /** 「12k / 128k」 */
  label: string
  breakdown: ModelUsageBreakdown
  segments: ContextSegment[]
  level: ContextLevel
  /** 最占上下文的消息（Top 5），点一条滚到那条消息 */
  drilldown: ContextMessageCost[]
  jumpToMessage: (id: string) => void
}

/**
 * 200ms 节流：流式时结构快照也可能几十毫秒变一次（工具结果连续追加），
 * 而上下文估算要遍历所有 part —— 合并到 5 次/秒，数字不再跟着 token 抖。
 */
function useThrottledValue<T>(value: T, ms = 200): T {
  const [throttled, setThrottled] = useState(value)
  const lastRun = useRef(0)
  useEffect(
    function () {
      if (Object.is(throttled, value)) return
      const elapsed = Date.now() - lastRun.current
      if (elapsed >= ms) {
        lastRun.current = Date.now()
        setThrottled(value)
        return
      }
      const timer = setTimeout(function () {
        lastRun.current = Date.now()
        setThrottled(value)
      }, ms - elapsed)
      return function () {
        clearTimeout(timer)
      }
    },
    [ms, throttled, value]
  )
  return throttled
}

function useContextUsageSnapshot(): ContextUsageSnapshot {
  // 用量写的是库内会话 id（runThreadPrompt 那条链路），这里必须同样折算
  const threadID = useSessionThreadID()
  const usage = useSyncExternalStore(subscribeGooseUsage, function () {
    return findGooseUsage(threadID)
  })
  const mode = useSyncExternalStore(subscribeAgentMode, readAgentMode, readAgentMode)
  // 估算不看正文：按结构订阅，流式时 composer 不再逐 token 重渲染
  const messages = useThrottledValue(useStructuralThreadMessages(), 200)

  const systemText = useMemo(
    function () {
      const scenario = findActiveScenario()
      const promptScenario =
        readAgentMode() === 'plan' && scenario === 'plan' ? 'general' : scenario
      return appendModeGuidance(findSystemPrompt(promptScenario, buildPromptContext()))
    },
    // 模式变了提示词的引导段会变，文字与 token 都要跟着重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode]
  )

  const breakdown = useMemo(
    function () {
      return estimateContextBreakdown({ systemText, messages })
    },
    [messages, systemText]
  )

  const segments = useMemo(
    function () {
      return splitContextSegments(breakdown)
    },
    [breakdown]
  )
  const drilldown = useMemo(
    function () {
      return rankMessagesByTokens(messages, 5)
    },
    [messages]
  )

  const provider = useProviderStore(function (state) {
    return state.providers.find(function (row) {
      return row.id === state.activeProviderID
    })
  })
  const providerID = provider?.id ?? ''
  const model = provider?.model?.trim() ?? ''
  /** 模型偏好里手动设的窗口：goose 静态目录给小了的时候靠它纠正（见 context-window.ts） */
  const prefWindow = providerID && model ? findModelPref(providerID, model).contextWindow : 0
  const window = pickContextWindow(usage?.size ?? 0, prefWindow)

  const used = usage?.used ?? 0
  const max = window.tokens
  // 分母被偏好覆盖时不能用 goose 的 label：否则气泡写「12k / 128k」、环画的是 1M
  const label =
    window.source === 'stats' && usage && usage.size > 0
      ? (formatGooseUsage(usage) ?? '—')
      : `${formatTokenCount(used)} / ${formatTokenCount(max)}`
  const level = contextLevelOf(used, max)

  /** 按属性值匹配而不是拼选择器，免得 message id 里出现引号把 querySelector 弄成语法错误 */
  const jumpToMessage = useCallback(function (id: string) {
    const nodes = document.querySelectorAll<HTMLElement>(
      '[data-message-id], [data-user-message-id]'
    )
    const target = Array.from(nodes).find(function (node) {
      return (node.dataset.messageId ?? node.dataset.userMessageId) === id
    })
    if (!target) {
      toast.info('这条消息不在当前视图里')
      return
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  return {
    usage,
    used,
    max,
    windowSource: window.source,
    label,
    breakdown,
    segments,
    level,
    drilldown,
    jumpToMessage
  }
}

export { FALLBACK_MAX_TOKENS, useContextUsageSnapshot }
export type { ContextUsageSnapshot }
