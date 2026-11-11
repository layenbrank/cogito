/**
 * Timeline（对齐 assistant-ui `elements/timeline`）
 *
 * 一条竖轴：左列时刻、中间圆点 + 连线、右列标题（可选一行说明）。
 * 「过去 / 现在 / 将来」三条状态写在一条 `when` 上，位置不参与上色：
 * - `past`：实心灰点，连线常规色；
 * - `now`：实心主色点 + 一圈光晕，标题加粗 —— 一条时间线通常只有一条 `now`；
 * - `future`：空心描边点，连线与标题都调淡；
 * 最后一条可见事件不画连线（逐条落进来的半程不会拖一根悬空的线）。
 *
 * 为什么用 `role="list"` 而不是一串 div：一条时间线是「有序的一组事件」，
 * 读屏按条播报「09:02 发布 0.14.1」；圆点与连线纯装饰，`aria-hidden`。
 * 元素不排序、不解析时刻、不读时钟 —— 顺序就是你给的顺序（契约同官网）。
 */
import { cn } from 'cn'

import { mono, paper, rowEnter } from './elements/surfaces'
import { clampVisibleCount, type TimelineEvent, type TimelineWhen } from './timeline-state'

interface TimelineProps extends Omit<React.ComponentProps<'div'>, 'children'> {
  /** 全量事件；只渲染前 `visibleCount` 条 */
  events: readonly TimelineEvent[]
  /** 逐条露出来的进度（钳在 0…events.length） */
  visibleCount: number
}

/** 圆点三态：位置不参与上色，只看这一条自己的 `when` */
const DOT_TONE: Record<TimelineWhen, string> = {
  past: 'bg-muted-foreground forced-colors:bg-[CanvasText]',
  now: 'bg-primary ring-4 ring-primary/15 forced-colors:bg-[Highlight]',
  future: 'border border-muted-foreground bg-transparent'
}

function Timeline(props: TimelineProps) {
  const { events, visibleCount, className, ...rest } = props
  const visible = events.slice(0, clampVisibleCount(visibleCount, events.length))

  return (
    <div
      data-slot="timeline"
      data-count={visible.length}
      role="list"
      className={cn(paper, 'flex w-full max-w-sm flex-col rounded-2xl p-4', className)}
      {...rest}>
      {visible.map(function (event, index) {
        const isLast = index === visible.length - 1
        return (
          <div
            key={event.id}
            data-slot="timeline-event"
            data-when={event.when}
            role="listitem"
            className={cn(rowEnter, 'grid grid-cols-[3.5rem_1rem_minmax(0,1fr)] gap-x-2')}>
            <time
              data-slot="timeline-time"
              className={cn(mono, 'pt-[3px] text-end tabular-nums')}>
              {event.time}
            </time>
            <span
              aria-hidden
              className="flex flex-col items-center">
              <span
                data-slot="timeline-dot"
                className={cn('mt-1 size-2 shrink-0 rounded-full', DOT_TONE[event.when])}
              />
              {isLast ? null : (
                <span
                  data-slot="timeline-connector"
                  className={cn(
                    'w-px flex-1',
                    event.when === 'future' ? 'bg-foreground/10' : 'bg-foreground/15'
                  )}
                />
              )}
            </span>
            <div className={cn('flex flex-col gap-0.5', isLast ? null : 'pb-3')}>
              <span
                data-slot="timeline-title"
                className={cn(
                  'text-sm break-words',
                  event.when === 'future' ? 'text-muted-foreground' : 'text-foreground/90',
                  event.when === 'now' && 'font-medium'
                )}>
                {event.title}
              </span>
              {event.detail ? (
                <span
                  data-slot="timeline-detail"
                  className="text-muted-foreground text-xs leading-relaxed break-words">
                  {event.detail}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export { Timeline }
export type { TimelineProps }
