/**
 * Context breakdown（对齐 assistant-ui `elements/context-breakdown`）
 *
 * 「窗口到底花在哪了」：一条按段着色的横条 + 图例，剩余（Headroom）是算出来的，
 * 不由宿主传。每段自带 `tint`，色条与图例圆点共用同一个类，永远对得上。
 *
 * 两个约定（照元素页）：
 * - `limit` 为 0 按「没有压力」处理，不做除法 —— 表头保持 muted，不会误报琥珀色；
 * - 每一段刷成 `role="meter"`，`0…100` 是它占 `limit` 的比例，`aria-valuetext` 念的
 *   数字与图例一致；四舍五入到 0 的段干脆不进色条，也不再被读屏念成一个空段。
 *
 * 与 `composer-context.tsx` 的分工：那边是 composer 轨道上的环（固定三段、自动配色），
 * 这里是任意命名的段 + 自定义颜色，用在详情面板里。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { mono, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 超过 85% 时表头的占用量转琥珀色（元素页口径） */
const CONTEXT_ALERT_RATIO = 0.85
/** 千分位：与元素页的 `112,900` 一致，也用固定 locale 免得测试随系统语言漂 */
const COUNT_FORMAT = new Intl.NumberFormat('en-US')

interface ContextSegment {
  /** 这一段是什么（图例里那行字） */
  label: string
  /** 原始 token 数，格式化交给元素 */
  tokens: number
  /** 色条与圆点共用的 Tailwind 背景类 */
  tint: string
}

interface ContextBreakdownProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** 占住窗口的几段，顺序即叠放顺序 */
  segments: readonly ContextSegment[]
  /** 窗口大小；0 当作无压力 */
  limit: number
  className?: string
}

function formatCount(value: number): string {
  return COUNT_FORMAT.format(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0)
}

function ContextBreakdown({ segments, limit, className, ...props }: ContextBreakdownProps) {
  const labels = useAssistantLabels()
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0
  const used = segments.reduce(function (sum, segment) {
    return sum + (Number.isFinite(segment.tokens) ? Math.max(0, segment.tokens) : 0)
  }, 0)
  const headroom = Math.max(0, safeLimit - used)
  const alert = safeLimit > 0 && used / safeLimit > CONTEXT_ALERT_RATIO

  return (
    <div
      data-slot="context-breakdown"
      className={cn(paper, 'flex w-full max-w-sm flex-col gap-3 rounded-2xl p-4', className)}
      {...props}>
      <div
        data-slot="context-breakdown-header"
        className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{labels.contextTitle}</span>
        <span
          data-slot="context-breakdown-total"
          className={cn(
            mono,
            'tabular-nums',
            alert ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
          )}>
          {formatCount(used)} / {formatCount(safeLimit)}
        </span>
      </div>

      <div
        data-slot="context-breakdown-bar"
        className="bg-foreground/[0.06] inset-ring-border flex h-2 w-full overflow-hidden rounded-full inset-ring forced-colors:border">
        {segments.map(function (segment) {
          const share = safeLimit > 0 ? (Math.max(0, segment.tokens) / safeLimit) * 100 : 0
          // 四舍五入到 0 的段不进色条：读屏不该听到一个空段
          if (Math.round(share * 10) / 10 <= 0) return null
          const announced = Math.round(share * 10) / 10
          return (
            <span
              key={segment.label}
              role="meter"
              aria-label={labels.contextMeterLabel(segment.label)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={announced}
              aria-valuetext={labels.contextMeterValue(
                formatCount(segment.tokens),
                formatCount(safeLimit)
              )}
              title={segment.label}
              className={cn(
                'h-full transition-[width] duration-500 ease-out forced-color-adjust-none motion-reduce:transition-none',
                segment.tint
              )}
              style={{ width: `${share}%` }}
            />
          )
        })}
      </div>

      <div
        data-slot="context-breakdown-legend"
        className="flex flex-col gap-1.5">
        {segments.map(function (segment) {
          return (
            <div
              key={segment.label}
              data-slot="context-breakdown-row"
              className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full forced-color-adjust-none',
                  segment.tint
                )}
              />
              <span className="text-foreground/70 min-w-0 flex-1 truncate text-xs">
                {segment.label}
              </span>
              <span className={cn(mono, 'shrink-0 tabular-nums')}>
                {formatCount(segment.tokens)}
              </span>
            </div>
          )
        })}

        <div
          data-slot="context-breakdown-headroom"
          className="flex items-center gap-2">
          <span
            aria-hidden
            className="bg-foreground/[0.08] inset-ring-border size-2 shrink-0 rounded-full inset-ring forced-colors:border"
          />
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
            {labels.contextHeadroom}
          </span>
          <span className={cn(mono, 'shrink-0 tabular-nums')}>{formatCount(headroom)}</span>
        </div>
      </div>
    </div>
  )
}

export { CONTEXT_ALERT_RATIO, ContextBreakdown }
export type { ContextBreakdownProps, ContextSegment }
