/**
 * 日程预览卡：plan 场景生成后浮在会话底部，可逐行改标题/时间，确认后批量写入日历。
 *
 * 写入是**一次事务**（后端 WriteP::Many）；成功后保留一批 id 支持一次性撤销。
 */
import {
  PlanScheduleCard as PlanScheduleCardSurface,
  PlanScheduleCardActions,
  PlanScheduleCardHeader,
  PlanScheduleCardRow,
  PlanScheduleCardWritten
} from '@cogito/design/assistant/plan-schedule-card.aui'
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
      <PlanScheduleCardWritten
        count={lastBatchIDs.length}
        onUndo={function () {
          void toRemoveEvents(lastBatchIDs)
            .then(function () {
              return toReadEvents()
            })
            .then(function () {
              clearBatch()
            })
        }}
        onDismiss={clearBatch}
      />
    )
  }

  return (
    <PlanScheduleCardSurface>
      <PlanScheduleCardHeader count={rows.length} />

      {conflicts.length > 0 ? (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
          {conflicts[0]}
          {conflicts.length > 1 ? `（共 ${conflicts.length} 处重叠）` : ''}
        </p>
      ) : null}

      <ul className="flex flex-col gap-1.5">
        {rows.map(function (row) {
          return (
            <PlanScheduleCardRow
              key={row.key}
              title={row.title}
              startAt={toLocalInput(row.startAt)}
              endAt={toLocalInput(row.endAt)}
              onTitleChange={function (next) {
                updateRow(row.key, { title: next })
              }}
              onStartChange={function (next) {
                const ms = fromLocalInput(next)
                if (ms === null) return
                const span = Math.max(row.endAt - row.startAt, 60_000)
                updateRow(row.key, { startAt: ms, endAt: ms + span })
              }}
              onEndChange={function (next) {
                const ms = fromLocalInput(next)
                if (ms === null || ms <= row.startAt) return
                updateRow(row.key, { endAt: ms })
              }}
              onRemove={function () {
                removeRow(row.key)
              }}
            />
          )
        })}
      </ul>

      <PlanScheduleCardActions
        onCancel={clear}
        onWrite={function () {
          void handleWrite()
        }}
        isWriting={isWriting}
      />
    </PlanScheduleCardSurface>
  )
}

export { PlanScheduleCard }
