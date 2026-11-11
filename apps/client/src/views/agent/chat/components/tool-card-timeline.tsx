/**
 * 时间轴卡（对齐 assistant-ui `elements/timeline`）
 *
 * 日历工具（`app_calendar_read`）的结果是一**组带时刻的事件**，不是一段正文：
 * 通用卡会把整块 JSON 摆出来，「今天还剩什么、现在在做什么」得自己找。
 * 竖轴卡把开始时刻排在左列，正在进行的这场安排加粗 + 光晕点，过去与将来靠点形区分。
 *
 * 三条口径：
 * - `when` 由当前时刻判定（过去的实心灰、正在的实心主色、将来的空心），元素不读时钟；
 * - 全天事件左列写「全天」，说明里不重复时段；
 * - 结果还没到 / 一条没有时只留一行状态，不画空轴。
 *
 * 只有**一条**安排时改走 `event-card`（对齐 `elements/generative-view-event`）：
 * 一行轴读不出「哪一天」，也压不住地点在版面上的分量；多条仍然用竖轴，
 * 因为那时候要比的是相对顺序。
 */
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { EventCard } from '@cogito/design/assistant/event-card'
import { useAssistantLabels } from '@cogito/design/assistant/labels'
import { Timeline } from '@cogito/design/assistant/timeline'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { clsx } from 'clsx'
import { useEffect, useMemo, useState } from 'react'

import {
  parseCalendarEvents,
  toClockLabel,
  toTimelineEvents,
  type CalendarEvent
} from '@/views/agent/chat/components/parse-tool-result'

type TimelineCardProps = ToolCallMessagePartProps & { outputText: string }

/**
 * 「现在」只在挂载后取一次：渲染期读时钟既过不了 `react-hooks/purity`，
 * 也会在每次重渲染时漂移；这张卡是历史消息的一部分，不跟着走秒。
 */
function useNow(): number {
  const [now, setNow] = useState(0)
  useEffect(function () {
    setNow(Date.now())
  }, [])
  return now
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** 日期抬头：`7月24日 · 周五`（格式写死，不跟系统 locale 漂） */
function toEventDateLabel(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`
}

/** 时段：`09:00 – 09:30`；全天用 labels 里的「全天」 */
function toEventTimeLabel(event: CalendarEvent, allDay: string): string {
  if (event.entireDay) return allDay
  const start = toClockLabel(event.startAt)
  if (!start) return ''
  const end = toClockLabel(event.endAt)
  return end && end !== start ? `${start} – ${end}` : start
}

/** 原始结果默认折叠：卡面只留人能读的部分，排查时再展开 */
function RawResult(props: { raw: string }) {
  const [isOpen, setOpen] = useState(false)
  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setOpen}
      className="w-full">
      <CollapsibleTrigger
        data-slot="tool-card-timeline-raw-trigger"
        className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-xs transition-colors">
        <Icon
          icon="lucide:chevron-right"
          className={clsx('size-3 transition-transform duration-200', isOpen && 'rotate-90')}
        />
        原始结果
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="bg-muted/50 text-foreground/90 mt-1 max-h-48 overflow-auto rounded-md p-2 text-xs whitespace-pre-wrap">
          {props.raw}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolCardTimeline(props: TimelineCardProps) {
  const labels = useAssistantLabels()
  const isRunning = props.status?.type === 'running'
  const raw = props.outputText.trim()
  const now = useNow()
  const calendarEvents = useMemo(
    function () {
      return parseCalendarEvents(props.result)
    },
    [props.result]
  )
  const events = useMemo(
    function () {
      return toTimelineEvents(calendarEvents, now, labels)
    },
    [calendarEvents, labels, now]
  )

  if (events.length === 0) {
    return (
      <p
        data-slot="tool-card-timeline-status"
        className={clsx(
          'text-muted-foreground my-1 text-xs',
          isRunning && 'shimmer motion-reduce:animate-none'
        )}>
        {isRunning ? labels.timelineReading : labels.timelineEmpty}
      </p>
    )
  }

  const only = calendarEvents.length === 1 && !isRunning ? calendarEvents[0] : null
  if (only) {
    return (
      <div
        data-slot="tool-card-timeline"
        className="my-1 flex w-full flex-col gap-1.5">
        <EventCard
          dateLabel={toEventDateLabel(only.startAt)}
          title={only.title || labels.timelineUntitled}
          timeLabel={toEventTimeLabel(only, labels.timelineAllDay)}
          location={only.notes}
        />
        {raw ? <RawResult raw={raw} /> : null}
      </div>
    )
  }

  return (
    <div
      data-slot="tool-card-timeline"
      className="my-1 flex flex-col gap-1.5">
      {isRunning ? (
        <p
          data-slot="tool-card-timeline-status"
          className="text-muted-foreground shimmer my-1 text-xs motion-reduce:animate-none">
          {labels.timelineReading}
        </p>
      ) : null}
      <Timeline
        events={events}
        visibleCount={events.length}
      />
      {raw ? <RawResult raw={raw} /> : null}
    </div>
  )
}

export { ToolCardTimeline }
export type { TimelineCardProps }
