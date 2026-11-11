/**
 * Composer context（对齐 assistant-ui `elements/composer-context`）
 *
 * composer 轨道上的一个**环**：外圈轨道 + 前景弧，弧长跟着
 * `system + tools + messages` 占 `total` 的比例走；悬停或键盘聚焦时，上方弹出一小块
 * 分段明细（三段固定配色 + 合计）。超过 85% 时环、百分比与按钮本身一起转红。
 *
 * 三个口径（照元素页）：
 * - 传入的数字按**千**读：`system: 12` 是 12k，不是 12 个 token；
 * - `total` 为 0 按「零占比」处理，不做除法；
 * - 面板只由 CSS 的 `group-hover` / `group-focus-within` 打开，没有 `open` prop。
 *
 * 三段配色固定（`bg-foreground/25` → `/45` → `/80`，越靠后越深），不可分段定制；
 * 需要任意命名 / 自定义颜色的段，用 `context-breakdown.tsx`。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { mono, paper } from './elements/surfaces'
import { useAssistantLabels } from './labels'

/** 超过 85% 转红（元素页口径） */
const COMPOSER_CONTEXT_ALERT_RATIO = 0.85
/** 环的几何：viewBox 16、半径 6、线宽 2.5（元素页原样） */
const RING_RADIUS = 6
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

interface ComposerUsage {
  /** 系统提示词（千 token） */
  system: number
  /** 工具 schema（千 token） */
  tools: number
  /** 对话消息（千 token） */
  messages: number
  /** 窗口上限（千 token） */
  total: number
}

interface ComposerContextProps extends Omit<ComponentProps<'div'>, 'children'> {
  usage: ComposerUsage
  className?: string
}

function toThousands(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

function ComposerContext({ usage, className, ...props }: ComposerContextProps) {
  const labels = useAssistantLabels()
  const system = toThousands(usage.system)
  const tools = toThousands(usage.tools)
  const messages = toThousands(usage.messages)
  const total = toThousands(usage.total)
  const used = system + tools + messages
  const ratio = total > 0 ? used / total : 0
  const percent = Math.round(ratio * 100)
  const alert = total > 0 && ratio > COMPOSER_CONTEXT_ALERT_RATIO
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(1, ratio))

  const rows: ReadonlyArray<{ key: string; label: string; value: number; tone: string }> = [
    { key: 'system', label: labels.contextSystem, value: system, tone: 'bg-foreground/25' },
    { key: 'tools', label: labels.contextTools, value: tools, tone: 'bg-foreground/45' },
    { key: 'messages', label: labels.contextMessages, value: messages, tone: 'bg-foreground/80' }
  ]

  function shareOf(value: number): number {
    return total > 0 ? (value / total) * 100 : 0
  }

  return (
    <div
      data-slot="composer-context"
      className={cn('group/ctx relative', className)}
      {...props}>
      <div
        data-slot="composer-context-panel"
        data-state={alert ? 'alert' : 'normal'}
        className={cn(
          paper,
          'pointer-events-none absolute end-0 bottom-full z-10 mb-2 flex w-60 origin-bottom-right scale-[0.97] flex-col gap-3.5 rounded-2xl p-4 opacity-0',
          'transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
          'group-focus-within/ctx:pointer-events-auto group-focus-within/ctx:scale-100 group-focus-within/ctx:opacity-100',
          'group-hover/ctx:pointer-events-auto group-hover/ctx:scale-100 group-hover/ctx:opacity-100'
        )}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">{labels.contextTitle}</p>
          <p
            data-slot="composer-context-percent"
            className={cn(
              mono,
              'tabular-nums',
              alert ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
            )}>
            {percent}%
          </p>
        </div>

        <div
          data-slot="composer-context-bar"
          className="bg-foreground/[0.06] inset-ring-border flex h-[5px] w-full gap-px overflow-hidden rounded-full inset-ring forced-colors:border">
          {rows.map(function (row) {
            return (
              <span
                key={row.key}
                aria-hidden
                className={cn(
                  'h-full transition-[width] duration-700 forced-color-adjust-none motion-reduce:transition-none',
                  row.tone
                )}
                style={{ width: `${shareOf(row.value)}%` }}
              />
            )
          })}
        </div>

        <div className="flex flex-col gap-2">
          {rows.map(function (row) {
            return (
              <div
                key={row.key}
                data-slot="composer-context-row"
                className="text-muted-foreground flex items-center gap-2.5 text-xs">
                <span
                  aria-hidden
                  className={cn('size-1.5 rounded-full forced-color-adjust-none', row.tone)}
                />
                <span className="flex-1">{row.label}</span>
                <span className={cn(mono, 'tabular-nums')}>{row.value}k</span>
              </div>
            )
          })}
        </div>

        <div className="bg-foreground/[0.06] h-px" />

        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>{labels.contextTotal}</span>
          <span className={cn(mono, 'tabular-nums')}>
            {used}k / {total}k
          </span>
        </div>
      </div>

      <button
        type="button"
        aria-label={labels.contextUsage}
        title={labels.contextUsage}
        data-slot="composer-context-trigger"
        className={cn(
          'flex size-8 items-center justify-center rounded-full outline-hidden',
          'transition-[background-color,color,scale] duration-150 hover:bg-foreground/[0.06] hover:text-foreground/90 active:scale-[0.96]',
          'focus-visible:ring-foreground/20 focus-visible:ring-1 motion-reduce:transition-none',
          'dark:hover:bg-foreground/[0.09]',
          alert ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
        )}>
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="size-4 -rotate-90">
          <circle
            cx="8"
            cy="8"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2.5"
            className="stroke-border"
          />
          <circle
            cx="8"
            cy="8"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            className="stroke-current transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
          />
        </svg>
      </button>
    </div>
  )
}

export { COMPOSER_CONTEXT_ALERT_RATIO, ComposerContext }
export type { ComposerContextProps, ComposerUsage }
