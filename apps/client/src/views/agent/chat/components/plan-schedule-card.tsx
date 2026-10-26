/**
 * 日程预览卡：plan 场景生成后浮在会话底部，可逐行改标题/时间，确认后批量写入日历。
 *
 * 写入是**一次事务**（后端 WriteP::Many）；成功后保留一批 id 支持一次性撤销。
 */
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Icon } from '@iconify/react/offline'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { findOverlaps, toWrites } from '@/features/agent/schedule-plan'
import { useCalendarStore } from '@/stores/calendar'
import { useScheduleDraftStore } from '@/stores/schedule-draft'
import { reportCaught } from '@/utils/exception-report'

function toLocalInput(ms: number): string {
  const date = new Date(ms)
  const pad = function (value: number): string {
    return String(value).padStart(2, '0')
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function fromLocalInput(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function PlanScheduleCard() {
  const rows = useScheduleDraftStore(function (state) {
    return state.rows
  })
  const lastBatchIDs = useScheduleDraftStore(function (state) {
    return state.lastBatchIDs
  })
  const updateRow = useScheduleDraftStore(function (state) {
    return state.updateRow
  })
  const removeRow = useScheduleDraftStore(function (state) {
    return state.removeRow
  })
  const clear = useScheduleDraftStore(function (state) {
    return state.clear
  })
  const rememberBatch = useScheduleDraftStore(function (state) {
    return state.rememberBatch
  })
  const clearBatch = useScheduleDraftStore(function (state) {
    return state.clearBatch
  })
  const events = useCalendarStore(function (state) {
    return state.events
  })
  const toWriteEvents = useCalendarStore(function (state) {
    return state.toWriteEvents
  })
  const toRemoveEvents = useCalendarStore(function (state) {
    return state.toRemoveEvents
  })
  const toReadEvents = useCalendarStore(function (state) {
    return state.toReadEvents
  })
  const [isWriting, setWriting] = useState(false)

  useEffect(
    function () {
      if (rows.length === 0 && lastBatchIDs.length === 0) return
      void toReadEvents()
    },
    [rows.length, lastBatchIDs.length, toReadEvents]
  )

  if (rows.length === 0 && lastBatchIDs.length === 0) return null

  const conflicts = findOverlaps(rows, events)

  async function handleWrite() {
    if (rows.length === 0) return
    setWriting(true)
    try {
      const ids = await toWriteEvents(toWrites(rows))
      await toReadEvents()
      rememberBatch(ids)
      toast.success(`已写入 ${ids.length} 条日程`, {
        action: {
          label: '撤销',
          onClick: function () {
            void toRemoveEvents(ids)
              .then(function () {
                return toReadEvents()
              })
              .then(function () {
                clearBatch()
                toast.success('已撤销本次写入')
              })
          }
        }
      })
    } catch (error) {
      reportCaught('agent.planSchedule.write', error)
      toast.error('写入日程失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setWriting(false)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="pointer-events-auto mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl border bg-background/95 px-3 py-2 text-sm shadow-lg">
        <span className="text-muted-foreground">已写入 {lastBatchIDs.length} 条日程</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={function () {
              void toRemoveEvents(lastBatchIDs)
                .then(function () {
                  return toReadEvents()
                })
                .then(function () {
                  clearBatch()
                })
            }}>
            撤销
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clearBatch}>
            关闭
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto mx-4 mb-3 max-h-[45vh] overflow-y-auto rounded-xl border bg-background/95 p-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Icon
          icon="lucide:calendar-plus"
          className="size-4"
        />
        待写入日程
        <span className="text-xs text-muted-foreground tabular-nums">{rows.length} 条</span>
      </div>

      {conflicts.length > 0 ? (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {conflicts[0]}
          {conflicts.length > 1 ? `（共 ${conflicts.length} 处重叠）` : ''}
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {rows.map(function (row) {
          return (
            <li
              key={row.key}
              className="flex flex-wrap items-center gap-1.5">
              <Input
                value={row.title}
                className="h-8 min-w-40 flex-1"
                onChange={function (event) {
                  updateRow(row.key, { title: event.target.value })
                }}
              />
              <Input
                type="datetime-local"
                value={toLocalInput(row.startAt)}
                className="h-8 w-44"
                onChange={function (event) {
                  const ms = fromLocalInput(event.target.value)
                  if (ms === null) return
                  const span = Math.max(row.endAt - row.startAt, 60_000)
                  updateRow(row.key, { startAt: ms, endAt: ms + span })
                }}
              />
              <Input
                type="datetime-local"
                value={toLocalInput(row.endAt)}
                className="h-8 w-44"
                onChange={function (event) {
                  const ms = fromLocalInput(event.target.value)
                  if (ms === null || ms <= row.startAt) return
                  updateRow(row.key, { endAt: ms })
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="移除这一行"
                onClick={function () {
                  removeRow(row.key)
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-4"
                />
              </Button>
            </li>
          )
        })}
      </ul>

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={clear}>
          取消
        </Button>
        <Button
          size="sm"
          disabled={isWriting}
          onClick={function () {
            void handleWrite()
          }}>
          {isWriting ? '写入中…' : '写入日历'}
        </Button>
      </div>
    </div>
  )
}

export { PlanScheduleCard }
