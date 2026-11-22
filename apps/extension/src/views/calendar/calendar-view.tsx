import { timeSphere } from '@cogito/utils'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'

import styles from '@/views/calendar/calendar-view.module.scss'
import { DayAgenda } from '@/views/calendar/day-agenda.tsx'
import { DayDetail } from '@/views/calendar/day-detail.tsx'
import { DayGrid } from '@/views/calendar/day-grid.tsx'
import { useCalendarStore } from '@/stores/calendar'
import { useReminderStore } from '@/stores/reminder'

function dayBounds(date: Dayjs): { from: number; to: number } {
  const start = date.startOf('day')
  return {
    from: start.valueOf(),
    to: start.add(1, 'day').valueOf()
  }
}

function monthBounds(date: Dayjs): { from: number; to: number } {
  const start = date.startOf('month').startOf('week')
  const end = date.endOf('month').endOf('week').add(1, 'day')
  return {
    from: start.valueOf(),
    to: end.valueOf()
  }
}

function CalendarView() {
  const [selectDate, onUpdateSelectDate] = useState<Dayjs>(function () {
    return dayjs()
  })
  const [panelDate, onUpdatePanelDate] = useState<Dayjs>(function () {
    return dayjs()
  })

  const events = useCalendarStore(function (state) {
    return state.events
  })
  const reminders = useReminderStore(function (state) {
    return state.reminders
  })
  const toReadEvents = useCalendarStore(function (state) {
    return state.toReadEvents
  })
  const toWriteEvent = useCalendarStore(function (state) {
    return state.toWriteEvent
  })
  const toRemoveEvent = useCalendarStore(function (state) {
    return state.toRemoveEvent
  })
  const toReadReminders = useReminderStore(function (state) {
    return state.toReadReminders
  })
  const toWriteReminder = useReminderStore(function (state) {
    return state.toWriteReminder
  })
  const toUpdateReminder = useReminderStore(function (state) {
    return state.toUpdateReminder
  })
  const toRemoveReminder = useReminderStore(function (state) {
    return state.toRemoveReminder
  })

  async function refreshRange(anchor: Dayjs) {
    const range = monthBounds(anchor)
    await Promise.all([
      toReadEvents({ rangeFrom: range.from, rangeTo: range.to }),
      toReadReminders({ dueFrom: range.from, dueTo: range.to })
    ])
  }

  useEffect(
    function () {
      void refreshRange(panelDate)
    },
    // 仅在面板月份变化时拉取区间数据
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panelDate.format('YYYY-MM')]
  )

  const dayRange = useMemo(
    function () {
      return dayBounds(selectDate)
    },
    [selectDate]
  )

  const dayEvents = useMemo(
    function () {
      return events.filter(function (event) {
        return event.endAt >= dayRange.from && event.startAt < dayRange.to
      })
    },
    [events, dayRange]
  )

  const dayReminders = useMemo(
    function () {
      return reminders.filter(function (reminder) {
        return (
          reminder.dueAt !== null &&
          reminder.dueAt !== undefined &&
          reminder.dueAt >= dayRange.from &&
          reminder.dueAt < dayRange.to
        )
      })
    },
    [reminders, dayRange]
  )

  const markedDates = useMemo(
    function () {
      const marks = new Set<string>()
      for (const event of events) {
        marks.add(timeSphere.format(new Date(event.startAt), 'YYYY-MM-DD'))
      }
      for (const reminder of reminders) {
        if (reminder.dueAt === null || reminder.dueAt === undefined) continue
        marks.add(timeSphere.format(new Date(reminder.dueAt), 'YYYY-MM-DD'))
      }
      return marks
    },
    [events, reminders]
  )

  async function handleWriteEvent(title: string, notes: string) {
    const bounds = dayBounds(selectDate)
    await toWriteEvent({
      title,
      notes,
      startAt: bounds.from,
      endAt: bounds.to - 1,
      entireDay: true
    })
    await refreshRange(panelDate)
  }

  async function handleWriteReminder(title: string, notes: string) {
    const bounds = dayBounds(selectDate)
    await toWriteReminder({
      title,
      notes,
      dueAt: bounds.from + 9 * 60 * 60 * 1000,
      entireDay: false,
      priority: 0
    })
    await refreshRange(panelDate)
  }

  async function handleToggleReminder(id: string, completed: boolean) {
    await toUpdateReminder({
      key: id,
      change: { archivedAt: completed ? Date.now() : null }
    })
    await refreshRange(panelDate)
  }

  async function handleRemoveEvent(id: string) {
    await toRemoveEvent(id)
    await refreshRange(panelDate)
  }

  async function handleRemoveReminder(id: string) {
    await toRemoveReminder(id)
    await refreshRange(panelDate)
  }

  return (
    <div
      className={styles.calendar}
      data-through="false">
      <div className={styles.layout}>
        <div className={clsx(styles.main, styles.gridPane)}>
          <DayGrid
            selectDate={selectDate}
            panelDate={panelDate}
            markedDates={markedDates}
            onSelectDate={function (date) {
              onUpdateSelectDate(date)
              if (!panelDate.isSame(date, 'month')) {
                onUpdatePanelDate(date)
              }
            }}
            onPanelDate={function (date) {
              onUpdatePanelDate(date)
            }}
          />
        </div>
        <aside className={styles.side}>
          <DayAgenda
            date={selectDate}
            events={dayEvents}
            reminders={dayReminders}
            onWriteEvent={handleWriteEvent}
            onWriteReminder={handleWriteReminder}
            onToggleReminder={handleToggleReminder}
            onRemoveEvent={handleRemoveEvent}
            onRemoveReminder={handleRemoveReminder}
          />
          <DayDetail date={selectDate} />
        </aside>
      </div>
    </div>
  )
}

export default CalendarView
