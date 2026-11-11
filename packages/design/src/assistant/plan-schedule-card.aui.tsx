import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import type { ComponentProps } from 'react'

import { Button } from '../components/button'
import { Input } from '../components/input'
import { OVERLAY_ELEVATION } from '../lib/surface'

/**
 * 日程预览卡：plan 场景生成后浮在会话底部，逐行改标题/时间，确认后批量写入日历。
 *
 * 纯展示：数据与写入逻辑在 app 侧（`plan-schedule-card.tsx` + `schedule-plan` / 日历 store），
 * 这里只负责卡片骨架与行编辑控件；冲突提醒、写事务、撤销由 app 用 props 接。
 *
 * 与 assistant-ui 的 `schedule-card` 元素（`schedule-card.tsx`，任务自动化的周期卡）不是一回事，
 * 所以文件名、`data-slot`、导出名都带 `plan-` 前缀，两者不会在同一棵树上撞车。
 */

type PlanScheduleCardProps = ComponentProps<'div'>

function PlanScheduleCard({ className, ...props }: PlanScheduleCardProps) {
  return (
    <div
      data-slot="plan-schedule-card"
      className={cn(
        'pointer-events-auto mx-4 mb-3 max-h-[45vh] overflow-y-auto rounded-xl bg-background/95 p-3',
        OVERLAY_ELEVATION,
        className
      )}
      {...props}
    />
  )
}

type PlanScheduleCardHeaderProps = ComponentProps<'div'> & { count: number }

function PlanScheduleCardHeader({ count, className, ...props }: PlanScheduleCardHeaderProps) {
  return (
    <div
      data-slot="plan-schedule-card-header"
      className={cn('mb-2 flex items-center gap-2 text-sm font-medium', className)}
      {...props}>
      <Icon
        icon="lucide:calendar-plus"
        className="size-4"
      />
      待写入日程
      <span className="text-muted-foreground text-xs tabular-nums">{count} 条</span>
    </div>
  )
}

type PlanScheduleCardDayProps = {
  /** 日期分组标题：`7月24日 · 周五` */
  label: string
  /** 当天几条，0 或不传就不显示 */
  count?: number
}

function PlanScheduleCardDay({ label, count, className, ...props }: PlanScheduleCardDayProps & ComponentProps<'div'>) {
  return (
    <div
      data-slot="plan-schedule-card-day"
      className={cn(
        'text-muted-foreground mt-2 mb-1 flex items-center gap-1.5 text-xs font-medium first:mt-0',
        className
      )}
      {...props}>
      <span>{label}</span>
      {count ? <span className="tabular-nums">{count} 条</span> : null}
    </div>
  )
}

type PlanScheduleCardRowProps = {
  title: string
  startAt: string
  endAt: string
  /** 人可读的时间段（`09:00 – 09:30` / `全天`）：行内输入是机器格式，扫一眼读不出来 */
  timeLabel?: string
  /** 备注 / 地点：有就摆在时间后面，和元素页一致 */
  notes?: string
  onTitleChange: (next: string) => void
  onStartChange: (next: string) => void
  onEndChange: (next: string) => void
  onRemove: () => void
}

function PlanScheduleCardRow(props: PlanScheduleCardRowProps) {
  return (
    <li
      data-slot="plan-schedule-card-row"
      className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Input
          value={props.title}
          className="h-8 min-w-40 flex-1"
          onChange={function (event) {
            props.onTitleChange(event.target.value)
          }}
        />
        <Input
          type="datetime-local"
          value={props.startAt}
          className="h-8 w-44"
          onChange={function (event) {
            props.onStartChange(event.target.value)
          }}
        />
        <Input
          type="datetime-local"
          value={props.endAt}
          className="h-8 w-44"
          onChange={function (event) {
            props.onEndChange(event.target.value)
          }}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="移除这一行"
          onClick={props.onRemove}>
          <Icon
            icon="lucide:x"
            className="size-4"
          />
        </Button>
      </div>
      {props.timeLabel || props.notes ? (
        <p
          data-slot="plan-schedule-card-row-meta"
          className="text-muted-foreground flex items-center gap-1 text-xs">
          {props.timeLabel ? <span className="tabular-nums">{props.timeLabel}</span> : null}
          {props.timeLabel && props.notes ? <span aria-hidden="true">·</span> : null}
          {props.notes ? (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              <Icon
                icon="lucide:map-pin"
                className="size-3 shrink-0"
              />
              <span className="truncate">{props.notes}</span>
            </span>
          ) : null}
        </p>
      ) : null}
    </li>
  )
}

type PlanScheduleCardActionsProps = {
  onCancel: () => void
  onWrite: () => void
  isWriting: boolean
}

function PlanScheduleCardActions(props: PlanScheduleCardActionsProps) {
  return (
    <div
      data-slot="plan-schedule-card-actions"
      className="mt-2 flex items-center justify-end gap-2">
      <Button
        size="sm"
        variant="ghost"
        onClick={props.onCancel}>
        取消
      </Button>
      <Button
        size="sm"
        disabled={props.isWriting}
        onClick={props.onWrite}>
        {props.isWriting ? '写入中…' : '写入日历'}
      </Button>
    </div>
  )
}

type PlanScheduleCardWrittenProps = {
  count: number
  onUndo: () => void
  onDismiss: () => void
  /** 写完给个出口：直接跳到日历磁贴看结果 */
  onOpenCalendar?: () => void
}

/** 已写入的收尾条：保留一批 id 支持一次性撤销 */
function PlanScheduleCardWritten(props: PlanScheduleCardWrittenProps) {
  return (
    <div
      data-slot="plan-schedule-card-written"
      className={cn(
        'pointer-events-auto mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl bg-background/95 px-3 py-2 text-sm',
        OVERLAY_ELEVATION
      )}>
      <span className="text-muted-foreground">已写入 {props.count} 条日程</span>
      <div className="flex items-center gap-1">
        {props.onOpenCalendar ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onOpenCalendar}>
            打开日历
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={props.onUndo}>
          撤销
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={props.onDismiss}>
          关闭
        </Button>
      </div>
    </div>
  )
}

export {
  PlanScheduleCard,
  PlanScheduleCardActions,
  PlanScheduleCardDay,
  PlanScheduleCardHeader,
  PlanScheduleCardRow,
  PlanScheduleCardWritten
}
export type {
  PlanScheduleCardActionsProps,
  PlanScheduleCardDayProps,
  PlanScheduleCardHeaderProps,
  PlanScheduleCardProps,
  PlanScheduleCardRowProps,
  PlanScheduleCardWrittenProps
}
