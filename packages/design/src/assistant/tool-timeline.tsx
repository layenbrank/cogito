/**
 * Tool timeline（对齐 assistant-ui `elements/tool-timeline`）
 *
 * 把**一整轮干过的事**收成一行：折叠条写「4 steps · 2 files changed」，
 * 展开是「动词 + 芯片」的竖向流水（Read thread.tsx / Ran pnpm vitest / Edited composer.tsx），
 * 末尾一排文件改动统计（`composer.tsx +14 −3`）。
 *
 * 与 `run-activity.tsx` 的分工（元素页自己也是这么说的）：
 * - Run activity 是**超集**：解说与工具交替、带持久化时长、结果留在折叠区外；本仓对话流用它；
 * - Tool timeline 是**紧凑清单**：只描述「做了什么」，不承载正文，适合长跑的工具流水。
 *   宿主真要两处都用时，别放进同一条消息的同一个位置 —— 那会出现两条折叠条。
 *
 * 数据由宿主映射（元素页口径）：库不猜工具名，`steps` / `stats` 全是别人算好的。
 * 图标用本仓的 iconify 名（离线集合），不走 lucide-react 组件 —— 与其余元素一致。
 *
 * 元素本体是收费产物，结构 / 状态 / 行为按官网渲染出的 DOM 自己写；字号走本仓档位
 * （正文 `text-sm`、芯片 `text-xs` mono），不照搬元素页的 13.5px / 11px。
 */
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/collapsible'
import { CHAT_DURATION_MS, CHAT_EASE_CLASS } from './chat-motion'
import { resolveVisibleSteps, type TimelineStat } from './tool-timeline-state'

interface ToolTimelineStep {
  /** 稳定 id：窗口会滑动（只看最近几步）时，留下的步才能保住自己的行 */
  readonly id?: string
  /** 动词：Read / Ran / Edited …（宿主映射，库不猜工具名） */
  readonly verb: string
  /** 芯片：文件名、命令、查询词 */
  readonly chip?: string
  /** @iconify 图标名（离线集合里已包含） */
  readonly icon: string
}

interface ToolTimelineProps {
  steps: readonly ToolTimelineStep[]
  /** 展开后可露出的步数（默认全出）；向下取整并钳进 `0…steps.length` */
  visibleSteps?: number
  /** 还在跑：折叠条换成 `activeLabel`，并且只有最后一步在闪 */
  streaming?: boolean
  /** 受控展开；不传则自己管 */
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** 已结束时的折叠条文案（宿主用 labels 拼：`4 steps · 2 files changed`） */
  restingLabel: ReactNode
  /** 仍在跑时的折叠条文案 */
  activeLabel: ReactNode
  /** 文件改动统计；为空时整排不渲染 */
  stats?: readonly TimelineStat[]
  /** 跳过动画（一次铺开几十步时用） */
  instant?: boolean
  className?: string
}

/**
 * 折叠条文案的交叉淡入：两个标签叠在同一格里，容器宽度跟着当前那条走 ——
 * 元素页的宽度动画就是这么来的（直接切文本会让折叠条抖一下）。量不到宽度时退回 `auto`。
 */
function TimelineLabel(props: {
  streaming: boolean
  restingLabel: ReactNode
  activeLabel: ReactNode
}) {
  const restingRef = useRef<HTMLSpanElement | null>(null)
  const activeRef = useRef<HTMLSpanElement | null>(null)
  const [width, updateWidth] = useState<number | undefined>(undefined)

  useEffect(
    function () {
      const node = props.streaming ? activeRef.current : restingRef.current
      if (!node) return
      const next = Math.round(node.getBoundingClientRect().width)
      // 字体没加载完 / 还没布局时量到 0：宁可不设宽度，也不能把文案裁没
      if (next <= 0) return
      updateWidth(function (previous) {
        return previous === next ? previous : next
      })
    },
    [props.streaming, props.restingLabel, props.activeLabel]
  )

  const labelClass = cn(
    'col-start-1 row-start-1 flex w-max items-center gap-1.5 leading-none',
    'transition-[opacity,filter] duration-(--animation-duration)',
    'ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none'
  )
  const hiddenClass = 'pointer-events-none select-none opacity-0 blur-[2px]'
  const shownClass = 'opacity-100 blur-none'

  return (
    <span
      data-slot="tool-timeline-label"
      className={cn(
        'grid overflow-x-clip text-start tabular-nums',
        'transition-[width] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        `duration-(--animation-duration)`
      )}
      style={width === undefined ? undefined : { width }}>
      <span
        ref={activeRef}
        aria-hidden={!props.streaming}
        className={cn(labelClass, props.streaming ? shownClass : hiddenClass)}>
        <span
          className={cn(
            'relative inline-block leading-none',
            props.streaming && 'shimmer shimmer-contrast motion-reduce:animate-none'
          )}>
          {props.activeLabel}
        </span>
      </span>
      <span
        ref={restingRef}
        aria-hidden={props.streaming}
        className={cn(labelClass, props.streaming ? hiddenClass : shownClass)}>
        {props.restingLabel}
      </span>
    </span>
  )
}

function ToolTimeline({
  steps,
  visibleSteps,
  streaming = false,
  open,
  defaultOpen = false,
  onOpenChange,
  restingLabel,
  activeLabel,
  stats = [],
  instant = false,
  className
}: ToolTimelineProps) {
  const [uncontrolledOpen, updateUncontrolledOpen] = useState(defaultOpen)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : uncontrolledOpen
  const animationMs = instant ? 0 : CHAT_DURATION_MS
  const visible = resolveVisibleSteps(visibleSteps, steps.length)
  const shown = steps.slice(0, visible)

  const handleOpenChange = useCallback(
    function (next: boolean) {
      if (!isControlled) updateUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange]
  )

  return (
    <div
      data-slot="tool-timeline"
      data-open={isOpen ? '' : undefined}
      data-streaming={streaming ? '' : undefined}
      className={cn('flex min-w-0 flex-col', className)}
      style={{ '--animation-duration': `${animationMs}ms` } as CSSProperties}>
      <Collapsible
        open={isOpen}
        onOpenChange={handleOpenChange}
        className="group/tool-timeline w-full">
        <CollapsibleTrigger
          data-slot="tool-timeline-trigger"
          aria-busy={streaming}
          className="group/trigger text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex max-w-full items-center gap-1.5 rounded-md py-1 text-sm outline-none transition-colors focus-visible:ring-[3px]">
          <Icon
            icon="lucide:chevron-right"
            data-slot="tool-timeline-trigger-chevron"
            className={cn(
              'size-3.5 shrink-0 opacity-60',
              `transition-transform duration-(--animation-duration) ${CHAT_EASE_CLASS} motion-reduce:transition-none`,
              'group-data-open/trigger:rotate-90',
              'group-data-panel-open/trigger:rotate-90'
            )}
          />
          <TimelineLabel
            streaming={streaming}
            restingLabel={restingLabel}
            activeLabel={activeLabel}
          />
        </CollapsibleTrigger>

        <CollapsibleContent
          data-slot="tool-timeline-content"
          className={cn('relative overflow-hidden outline-none', instant && 'transition-none!')}>
          <div className="flex flex-col gap-2.5 ps-4 pt-2.5">
            {shown.map(function (step, index) {
              // 只有「最后露出的那一步」在闪：前面的步在跑也算落地了
              const isActive = streaming && index === shown.length - 1
              return (
                <div
                  key={step.id ?? `${step.verb}-${index}`}
                  data-slot="tool-timeline-step"
                  data-verb={step.verb}
                  className={cn(
                    'text-muted-foreground fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex min-w-0 items-center gap-2 text-sm',
                    `duration-(--animation-duration) ${CHAT_EASE_CLASS} motion-reduce:animate-none`
                  )}>
                  <Icon
                    icon={step.icon}
                    className="size-3.5 shrink-0"
                  />
                  <span
                    className={cn(
                      'relative inline-block shrink-0 leading-none',
                      isActive && 'shimmer shimmer-contrast motion-reduce:animate-none'
                    )}>
                    {step.verb}
                  </span>
                  {step.chip ? (
                    <span
                      data-slot="tool-timeline-chip"
                      title={step.chip}
                      className="bg-foreground/5 text-muted-foreground inline-block min-w-0 truncate rounded-md px-1.5 py-0.5 font-mono text-xs">
                      {step.chip}
                    </span>
                  ) : null}
                </div>
              )
            })}

            {stats.length > 0 ? (
              <div
                data-slot="tool-timeline-stats"
                className="flex flex-wrap gap-1.5 pt-1">
                {stats.map(function (stat, index) {
                  return (
                    <span
                      key={`${stat.file}-${index}`}
                      data-slot="tool-timeline-stat"
                      className="bg-foreground/5 text-muted-foreground inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs">
                      <span className="truncate">{stat.file}</span>
                      {stat.added === undefined ? null : (
                        <span className="text-success shrink-0">+{stat.added}</span>
                      )}
                      {stat.removed === undefined ? null : (
                        <span className="text-destructive shrink-0">−{stat.removed}</span>
                      )}
                    </span>
                  )
                })}
              </div>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export { ToolTimeline }
export type { ToolTimelineProps, ToolTimelineStep }
