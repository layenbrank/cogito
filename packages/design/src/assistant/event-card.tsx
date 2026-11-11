/**
 * Event card（对齐 assistant-ui `elements/generative-view-event`）
 *
 * 一条日程的「详情抬头」：日期小字 → 标题 → 时段 · 地点。元素本身只有三行，
 * 这里也不加按钮和边框装饰：它是工具结果里的一次性说明，不是可操作卡片。
 *
 * 多个事件仍走 `timeline`（竖轴），单条才用这张 —— 一行轴读得出「什么时候」，
 * 但读不出「哪一天」和地点在版面上的分量。
 */
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { paper } from './elements/surfaces'

interface EventCardProps extends Omit<ComponentProps<'section'>, 'title' | 'children'> {
  /** 日期抬头：`7月24日 · 周五`（格式由宿主决定，元素不解析日期） */
  dateLabel: string
  title: string
  /** 时段：`09:00 – 09:30` / `全天`；没有就不出这一行 */
  timeLabel?: string
  /** 地点或备注；与 `timeLabel` 用中点拼在同一行 */
  location?: string
}

function EventCard({
  dateLabel,
  title,
  timeLabel,
  location,
  className,
  ...props
}: EventCardProps) {
  const meta = [timeLabel, location]
    .map(function (part) {
      return part?.trim() ?? ''
    })
    .filter(function (part) {
      return part.length > 0
    })
    .join(' · ')

  return (
    <section
      data-slot="event-card"
      className={cn(paper, 'flex w-full flex-col gap-0.5 rounded-2xl p-4', className)}
      {...props}>
      <p
        data-slot="event-card-date"
        className="text-muted-foreground text-xs font-medium">
        {dateLabel}
      </p>
      <h2
        data-slot="event-card-title"
        title={title}
        className="truncate text-base font-semibold">
        {title}
      </h2>
      {meta ? (
        <p
          data-slot="event-card-meta"
          className="text-muted-foreground text-xs break-words">
          {meta}
        </p>
      ) : null}
    </section>
  )
}

export { EventCard }
export type { EventCardProps }
