import type { ChatUsage } from '@cogito/chat/ports'
import { useAuiState, type ThreadMessage } from '@assistant-ui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'

import { clearQuotaCheck } from '@/features/quota/gate.ts'
import { QUOTA_KEY } from '@/features/quota/usage.ts'

/**
 * 用量有两个口径，**分工**：
 *
 * - 消息口径（本文件上半部分）：主进程把 `ChatUsage` 挂在消息 `metadata.custom.usage` 上
 *   （见 `@cogito/chat/adapters/chat-model`），这里把它读回来。这是历史里自带的数字，
 *   跟着消息走 —— 取消运行的那一条会被 runtime 丢掉，所以它只能当「消息上标了多少」。
 * - 账本口径（下半部分）：主进程每轮运行**结算时**记一笔（`engine.settle` 先记账再发终态），
 *   成功 / 取消 / 失败都算。取消不再漏计，也不依赖消息还在不在。
 */

/**
 * 用量：主进程 `finish` 事件把 `ChatUsage` 挂在消息 `metadata.custom.usage` 上
 * （见 `@cogito/chat/adapters/chat-model`），这里把它读回来。
 *
 * 读的是**我们自己的**契约，不是 provider 的原始字段 —— 换后端（opencode / 其它）
 * 这段都不用动。
 */
function readUsage(metadata: unknown): ChatUsage | undefined {
  if (typeof metadata !== 'object' || metadata === null) return undefined

  const custom = (metadata as { custom?: unknown }).custom
  if (typeof custom !== 'object' || custom === null) return undefined

  const usage = (custom as { usage?: unknown }).usage
  if (typeof usage !== 'object' || usage === null) return undefined

  const { inputTokens, outputTokens, totalTokens } = usage as Record<string, unknown>
  const result: ChatUsage = {}

  if (typeof inputTokens === 'number') result.inputTokens = inputTokens
  if (typeof outputTokens === 'number') result.outputTokens = outputTokens
  if (typeof totalTokens === 'number') result.totalTokens = totalTokens

  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * 会话累计用量：把线程里所有报了用量的助手消息按字段相加。
 *
 * 口径就是**本会话累计** —— 底栏的 title（「本会话累计 token（输入 + 输出）」）与右栏文案
 * 都这么写；只取最后一条的话，数字与文案对不上（用户看到的是「上一次回复」）。
 *
 * 单条的合计按 `totalTokens` 取，provider 只报了分项时用「输入 + 输出」兜底：这样
 * 「有分项 ⇒ 有合计」，底栏不必再猜合计（拿输入当合计）。分项缺失就保持缺失（不写 0），
 * 右栏照旧显示 `-`，不把「没报」说成「没花」。
 *
 * **只在选区外算**：`useAuiState` 内部就是裸的 `useSyncExternalStore`，选区结果按
 * `Object.is` 比对（每次调用都要返回同一个引用），派生对象一律放到 `useMemo` 里，
 * 否则每帧都被判成「快照变了」→ `Maximum update depth exceeded` → 整个路由被
 * ErrorBoundary 换成错误页。选区只回 `state.thread.messages` 这个原引用。
 */
function sumUsage(messages: readonly ThreadMessage[] | undefined): ChatUsage | undefined {
  if (!messages) return undefined

  const total: ChatUsage = {}
  let found = false

  for (const message of messages) {
    if (message.role !== 'assistant') continue

    const usage = readUsage(message.metadata)
    if (!usage) continue

    found = true
    if (usage.inputTokens !== undefined) {
      total.inputTokens = (total.inputTokens ?? 0) + usage.inputTokens
    }
    if (usage.outputTokens !== undefined) {
      total.outputTokens = (total.outputTokens ?? 0) + usage.outputTokens
    }
    total.totalTokens =
      (total.totalTokens ?? 0) +
      (usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
  }

  return found ? total : undefined
}

function useThreadUsage(): ChatUsage | undefined {
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })

  return useMemo(
    function () {
      return sumUsage(messages)
    },
    [messages]
  )
}

/** 账本查询的键前缀。与服务端配额（`quota`）分开：这份是 studio 本机的账。 */
const USAGE_KEY = 'usage'

/** 账本聚合结果（契约见 `shared/ipc/specs/chat.ts`，类型由契约推导） */
type UsageLedger = Awaited<ReturnType<typeof itc.chat.usage.toRead>>

/**
 * 读账本：本会话累计 + 今日合计。
 *
 * 本会话按 `runs` 判空 —— 新会话还没落库时 `sessionID` 是 null，那时只有今日合计可看。
 */
function useUsageLedger(sessionID: string | null) {
  return useQuery({
    queryKey: [USAGE_KEY, sessionID],
    queryFn: function () {
      return itc.chat.usage.toRead({ sessionID })
    }
  })
}

/**
 * 一轮跑完（true → false）就把用量与配额的缓存作废 —— 这是「对话结束后自动取一次」。
 *
 * 为什么要界面来拉这一下：这一轮的消耗要等**终态落地**才写进账本（主进程 `engine.settle`
 * 先记账再发终态），平台侧的 `used` 更要等网关自己汇总 —— 不主动失效就一直显示运行前的
 * 数字，用户看到的就是「花了 token 但用量没动」。
 *
 * 只在「true → false」的这个边沿触发：挂载时也来一发的话，每次切会话都白发一轮请求。
 *
 * 入参是**运行状态**而不是自己去读 aui：这样这层逻辑能在测试里直接驱动
 * （见 `usage.refresh.test.tsx`），读状态那一步留在 `useRefreshUsageOnRunEnd`。
 */
function useRefreshOnRunEnd(isRunning: boolean): void {
  const client = useQueryClient()
  const wasRunning = useRef(false)

  useEffect(
    function () {
      if (isRunning) {
        wasRunning.current = true
        return
      }
      if (!wasRunning.current) return

      wasRunning.current = false
      // 发送前的拦截另有一份缓存判定（`quota/gate.ts`），额度变了得一起作废
      clearQuotaCheck()
      void client.invalidateQueries({ queryKey: [USAGE_KEY] })
      void client.invalidateQueries({ queryKey: [QUOTA_KEY] })
    },
    [isRunning, client]
  )
}

/** 会话底栏常驻，所以运行结束的那次刷新它自己就能做（见 `useRefreshOnRunEnd`） */
function useRefreshUsageOnRunEnd(): void {
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })

  useRefreshOnRunEnd(isRunning)
}

function formatCount(value: number | undefined): string {
  return value === undefined ? '-' : String(value)
}

/** 输入框底栏用：`1.2k` 口径；无可读字段时返回 null */
function formatTokenShort(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 1_000_000)}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}

/** 输入框底栏用：`1.2k` 口径；合计未知时返回 null（`sumUsage` 保证有分项就有合计，不必猜） */
function formatUsageCompact(usage: ChatUsage | undefined): string | null {
  if (!usage || usage.totalTokens === undefined) return null

  return formatTokenShort(usage.totalTokens)
}

/** 右栏详述：无可读字段时返回 null（不渲染用量行） */
function formatUsage(usage: ChatUsage | undefined): string | null {
  if (!usage) return null

  return [
    `输入 ${formatCount(usage.inputTokens)}`,
    `输出 ${formatCount(usage.outputTokens)}`,
    `合计 ${formatCount(usage.totalTokens)}`
  ].join(' · ')
}

export {
  formatUsage,
  formatUsageCompact,
  readUsage,
  sumUsage,
  USAGE_KEY,
  useRefreshOnRunEnd,
  useRefreshUsageOnRunEnd,
  useThreadUsage,
  useUsageLedger
}
export type { UsageLedger }
