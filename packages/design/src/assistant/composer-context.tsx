/**
 * Composer context（对齐 assistant-ui `elements/composer-context`）
 *
 * composer 轨道上的一个**环**：外圈轨道 + 前景弧，弧长跟着
 * `system + tools + messages` 占 `total` 的比例走；悬停或键盘聚焦时，上方弹出一小块
 * 分段明细（三段配色 + 合计）。超过 85% 时环、百分比与按钮本身一起转红。
 *
 * 悬停要能走完「按钮 → 面板」这一程：面板外面包一层 `pb-2` 的定位容器，打开时
 * 这 8px 也算面板的一部分 —— 否则鼠标穿过空隙的那一瞬 `group-hover` 断掉，
 * 面板直接缩回去，用户看到的就是「悬浮不起来」。
 *
 * 三个口径（照元素页）：
 * - 传入的数字按**千**读：`system: 12` 是 12k，不是 12 个 token；
 * - `total` 为 0 按「零占比」处理，不做除法；
 * - 面板只由 CSS 的 `group-hover` / `group-focus-within` 打开，没有 `open` prop。
 *
 * 三段默认是 `bg-foreground/25` → `/45` → `/80`（越靠后越深）；调用方可以传 `tones`
 * 换成自己那套分段色（例如右栏「上下文」卡片的 sky / violet / amber），这样气泡与
 * 详情卡才是同一份图例；需要任意命名 / 自定义颜色的段，用 `context-breakdown.tsx`。
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

/** 三段的默认色调（元素页口径：越靠后越深） */
const DEFAULT_TONES = {
  system: 'bg-foreground/25',
  tools: 'bg-foreground/45',
  messages: 'bg-foreground/80'
} as const

type ContextTone = 'ok' | 'warn' | 'danger'

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
  /**
   * 占用档位。传了就按它上色（右栏 `contextLevelOf` 的同一套阈值，70% 提醒 / 90% 告警）；
   * 不传就只看元素自带的 85% 红线。**两个口径都要有**：环是元素，右栏是业务。
   */
  level?: ContextTone
  /** 三段色调：传右栏那套分段色，气泡与详情卡才是一份图例 */
  tones?: Partial<Record<keyof typeof DEFAULT_TONES, string>>
  className?: string
}

function toThousands(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** 档位 → 文字色（warning 用琥珀、danger 用红，ok 跟其余次要文字一致） */
function toneOfLevel(level: ContextTone): string {
  if (level === 'danger') return 'text-red-500 dark:text-red-400'
  if (level === 'warn') return 'text-amber-600 dark:text-amber-400'
  return 'text-muted-foreground'
}

function ComposerContext({ usage, level, tones, className, ...props }: ComposerContextProps) {
  const labels = useAssistantLabels()
  const system = toThousands(usage.system)
  const tools = toThousands(usage.tools)
  const messages = toThousands(usage.messages)
  const total = toThousands(usage.total)
  const used = system + tools + messages
  const ratio = total > 0 ? used / total : 0
  const percent = Math.round(ratio * 100)
  const alert = total > 0 && ratio > COMPOSER_CONTEXT_ALERT_RATIO
  /** 元素自己的红线优先：过 85% 一定是 danger，不受调用方 level 影响 */
  const resolved: ContextTone = alert ? 'danger' : (level ?? 'ok')
  const accent = toneOfLevel(resolved)
  const dashOffset = RING_CIRCUMFERENCE * (1 - Math.min(1, ratio))

  const rows: ReadonlyArray<{
    key: keyof typeof DEFAULT_TONES
    label: string
    value: number
    tone: string
  }> = [
    {
      key: 'system',
      label: labels.contextSystem,
      value: system,
      tone: tones?.system ?? DEFAULT_TONES.system
    },
    {
      key: 'tools',
      label: labels.contextTools,
      value: tools,
      tone: tones?.tools ?? DEFAULT_TONES.tools
    },
    {
      key: 'messages',
      label: labels.contextMessages,
      value: messages,
      tone: tones?.messages ?? DEFAULT_TONES.messages
    }
  ]

  function shareOf(value: number): number {
    return total > 0 ? (value / total) * 100 : 0
  }

  return (
    <div
      data-slot="composer-context"
      data-level={resolved}
      className={cn('group/ctx relative', className)}
      {...props}>
      {/*
       * 外层只负责定位与「撑住悬停通道」：pb-2 把原来 mb-2 留出的空隙并进面板，
       * 指针从按钮往上走时始终落在 group 的后代里，group-hover 不断。
       * 关着时整块 pointer-events-none，不会挡住上面的对话。
       */}
      <div
        className={cn(
          'pointer-events-none absolute end-0 bottom-full z-10 w-60 pb-2',
          'group-hover/ctx:pointer-events-auto group-focus-within/ctx:pointer-events-auto'
        )}>
        <div
          data-slot="composer-context-panel"
          data-state={alert ? 'alert' : resolved === 'warn' ? 'warn' : 'normal'}
          className={cn(
            paper,
            'flex origin-bottom-right scale-[0.97] flex-col gap-3.5 rounded-2xl p-4 opacity-0',
            'transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            'group-hover/ctx:scale-100 group-hover/ctx:opacity-100',
            'group-focus-within/ctx:scale-100 group-focus-within/ctx:opacity-100'
          )}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{labels.contextTitle}</p>
            <p
              data-slot="composer-context-percent"
              className={cn(mono, 'tabular-nums', accent)}>
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
          resolved === 'ok' ? 'text-muted-foreground' : accent
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
export type { ComposerContextProps, ComposerUsage, ContextTone }
