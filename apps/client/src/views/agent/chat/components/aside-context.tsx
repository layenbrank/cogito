/**
 * 右栏「详情」里的上下文卡：气泡只给概览，明细收在这里，不再单独占一个页签。
 *
 * 默认只露「已用多少 + 进度 + 剩余」，点「展开」或从气泡点「查看详情」才铺开
 * 分段明细与最占消息 —— 详情面板要能一眼扫完，上下文是二级信息。
 * 提示词原文不对用户展示，只作为分段估算的输入。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Progress } from '@cogito/design/components/progress'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

import type { ContextLevel } from '@/features/agent/context-breakdown'

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

function AsideContextSection() {
  const { used, max, segments, level, drilldown, jumpToMessage } = useContextUsageSnapshot()
  const [isOpen, updateOpen] = useState(false)
  const sectionRef = useRef<HTMLDivElement | null>(null)

  const ratio = max > 0 ? Math.min(1, used / max) : 0
  const remain = Math.max(0, max - used)
  const segmentTotal = segments.reduce(function (sum, segment) {
    return sum + segment.tokens
  }, 0)

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
        <Progress value={ratio * 100} />
        <div className="text-muted-foreground flex min-w-0 items-center gap-3 text-xs tabular-nums">
          <span className="shrink-0 font-mono">
            {formatTokens(used)} / {formatTokens(max)}
          </span>
          <span className="shrink-0">剩余 {formatTokens(remain)}</span>
          {level === 'ok' ? null : (
            <span className={clsx('ms-auto shrink-0', LEVEL_TEXT[level])}>
              {level === 'danger' ? '接近上限' : '已用超过 70%'}
            </span>
          )}
        </div>

        {isOpen ? (
          <div className="border-border/60 flex flex-col gap-2.5 border-t pt-2.5">
            {segmentTotal > 0 ? (
              <ul className="flex flex-col gap-2">
                {segments.map(function (segment) {
                  const percent = Math.round(segment.ratio * 100)
                  return (
                    <li
                      key={segment.key}
                      className="flex items-center gap-2 text-xs">
                      <span
                        aria-hidden
                        className={clsx('size-2 shrink-0 rounded-full', segment.tone)}
                      />
                      <span
                        className="text-muted-foreground w-16 shrink-0 truncate"
                        title={segment.label}>
                        {segment.label}
                      </span>
                      <span className="bg-muted h-1 min-w-0 flex-1 overflow-hidden rounded-full">
                        <span
                          className={clsx(
                            'block h-full rounded-full transition-[width] duration-300',
                            segment.tone
                          )}
                          style={{ width: `${percent}%` }}
                        />
                      </span>
                      <span className="w-11 shrink-0 text-right font-mono tabular-nums">
                        {formatTokens(segment.tokens)}
                      </span>
                      <span className="text-muted-foreground w-8 shrink-0 text-right font-mono tabular-nums">
                        {percent}%
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-muted-foreground text-xs leading-relaxed">
                发出第一条消息后显示各段估算
              </p>
            )}

            {drilldown.length > 0 ? (
              <div className="flex flex-col gap-0.5">
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

            <p className="text-muted-foreground/80 text-[11px] leading-relaxed">
              窗口占用来自会话统计；分段与「最占」为请求前估算（约 4 字符 ≈ 1 token）。
            </p>
          </div>
        ) : null}
      </AsideSection>
    </div>
  )
}

export { AsideContextSection }
