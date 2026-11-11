/**
 * 右栏「详情」里的上下文卡：气泡只给一个环，明细收在这里，不再单独占一个页签。
 *
 * 收起时只留一行安静的数字（已用 / 上限 + 剩余）；点「展开」才铺开
 * 元素 `context-breakdown` 的分段条与图例（剩余也由它算），再往下是「最占上下文」。
 * 提示词原文不对用户展示，只作为分段估算的输入。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { ContextBreakdown } from '@cogito/design/assistant/context-breakdown'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CONTEXT_SEGMENT_META,
  type ContextLevel,
  type ContextSegmentKey
} from '@/features/agent/context-breakdown'

import { AsideSection } from './aside-section'
import { subscribeAsideContext } from './open-aside-context'
import { useContextUsageSnapshot } from './use-context-usage.ts'

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

const LEVEL_TEXT: Record<ContextLevel, string> = {
  ok: 'text-muted-foreground',
  warn: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive'
}

/** 段 → 色条类：复用「最占上下文」那套 tone，别在这里再抄一份颜色 */
function findTone(key: ContextSegmentKey): string {
  const meta = CONTEXT_SEGMENT_META.find(function (item) {
    return item.key === key
  })
  return meta ? meta.tone : 'bg-foreground/25'
}

function AsideContextSection() {
  const { used, max, breakdown, level, drilldown, jumpToMessage } = useContextUsageSnapshot()
  const labels = useAssistantLabels()
  const [isOpen, updateOpen] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)

  const ratio = max > 0 ? Math.min(1, used / max) : 0
  const remain = Math.max(0, max - used)

  /**
   * 四段 → 明细卡要的形状。会话统计优先：对话段收口成
   * `已用 - 系统 - 工具 - 附件`，四段之和正好等于真实占用，不会出现
   * 「图例加起来比表头还多」；还没拿到统计时退回估算值。
   */
  const cardSegments = useMemo(
    function () {
      const system = breakdown.systemTokens ?? 0
      const tools = breakdown.toolTokens ?? 0
      const attachments = breakdown.attachmentTokens ?? 0
      const estimatedHistory = breakdown.historyTokens ?? 0
      const history = used > 0 ? Math.max(0, used - system - tools - attachments) : estimatedHistory
      return [
        { label: labels.contextSystem, tokens: system, tint: findTone('system') },
        { label: labels.contextTools, tokens: tools, tint: findTone('tool') },
        { label: labels.contextAttachments, tokens: attachments, tint: findTone('attachment') },
        { label: labels.contextMessages, tokens: history, tint: findTone('history') }
      ]
    },
    [breakdown, labels, used]
  )

  /** 气泡「查看详情」：展开卡片并滚到它（同一张卡，不再切页签） */
  useEffect(function () {
    return subscribeAsideContext(function () {
      updateOpen(true)
      // 展开是下一帧才改高度：等它落定再滚，否则滚到的是收起时的高度
      window.requestAnimationFrame(function () {
        sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    })
  }, [])

  return (
    <div ref={sectionRef}>
      <AsideSection
        icon="lucide:database"
        iconClass="text-primary"
        title="上下文"
        meta={`已用 ${Math.round(ratio * 100)}%`}
        action={
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-5 px-1 text-xs"
            onClick={function () {
              updateOpen(!isOpen)
            }}>
            {isOpen ? '收起' : '展开'}
          </Button>
        }>
        <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs tabular-nums">
          <span className="shrink-0 font-mono">
            {formatTokens(used)} / {formatTokens(max)}
          </span>
          {/* 展开后「剩余」由元素的 Headroom 那行给，这里不重复写 */}
          {isOpen ? null : <span className="shrink-0">剩余 {formatTokens(remain)}</span>}
          {level === 'ok' ? null : (
            <span className={clsx('ms-auto shrink-0', LEVEL_TEXT[level])}>
              {level === 'danger' ? '接近上限' : '已用超过 70%'}
            </span>
          )}
        </div>

        {isOpen ? (
          used > 0 ? (
            <ContextBreakdown
              // 元素自带的卡片外观在这里多余：标题与数字上面已经有了，只取色条与图例
              className="max-w-none gap-2.5 rounded-none border-0 bg-transparent p-0 [&>[data-slot=context-breakdown-header]]:hidden"
              segments={cardSegments}
              limit={max}
            />
          ) : (
            <p className="text-muted-foreground text-xs leading-relaxed">
              发出第一条消息后显示各段估算
            </p>
          )
        ) : (
          <Progress value={ratio * 100} />
        )}

        {isOpen && drilldown.length > 0 ? (
          <div className="border-border/60 flex flex-col gap-0.5 border-t pt-2.5">
            <span className="text-muted-foreground text-xs font-medium">最占上下文</span>
            <ul className="flex flex-col gap-0.5">
              {drilldown.map(function (item) {
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      title={item.label}
                      onClick={function () {
                        jumpToMessage(item.id)
                      }}
                      className="hover:bg-muted/60 flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start transition-colors">
                      <Icon
                        icon={item.role === 'user' ? 'lucide:user' : 'lucide:bot'}
                        className="text-muted-foreground size-3.5 shrink-0"
                      />
                      <span className="text-foreground min-w-0 flex-1 truncate text-[13px] leading-snug">
                        {item.label}
                      </span>
                      <span className="text-muted-foreground shrink-0 font-mono text-xs tabular-nums">
                        {formatTokens(item.tokens)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        {isOpen ? (
          <p className="text-muted-foreground/80 text-[11px] leading-relaxed">
            窗口占用来自会话统计；分段与「最占」为请求前估算（约 4 字符 ≈ 1 token）。
          </p>
        ) : null}
      </AsideSection>
    </div>
  )
}

export { AsideContextSection }
