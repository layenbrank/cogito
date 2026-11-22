import { create } from 'zustand'

import { database, type CalendarEventRow } from '@/database/database.ts'

type Calendar = CalendarEventRow

interface CalendarWrite {
  title: string
  notes?: string
  startAt: number
  endAt: number
  entireDay?: boolean
  color?: string | null
  reminderID?: string | null
}

interface CalendarRead {
  rangeFrom?: number
  rangeTo?: number
}

interface CalendarState {
  events: Calendar[]
  toReadEvents: (filter?: CalendarRead) => Promise<Calendar[]>
  toWriteEvent: (value: CalendarWrite) => Promise<string | undefined>
  toRemoveEvent: (key: string) => Promise<void>
}

const useCalendarStore = create<CalendarState>(function (set) {
  return {
    events: [],

    async toReadEvents(filter) {
      const rows = (await database.calendarEvent.toArray()).filter(function (event) {
        return !event.archivedAt
      })
      set({ events: rows })
      if (!filter) return rows
      return rows.filter(function (event) {
        if (filter.rangeFrom !== undefined && event.endAt < filter.rangeFrom) return false
        if (filter.rangeTo !== undefined && event.startAt >= filter.rangeTo) return false
        return true
      })
    },

    async toWriteEvent(value) {
      const now = Date.now()
      const row: Calendar = {
        id: crypto.randomUUID(),
        title: value.title.trim() || '未命名',
        notes: value.notes ?? '',
        startAt: value.startAt,
        endAt: value.endAt,
        entireDay: value.entireDay ?? false,
        color: value.color ?? null,
        reminderID: value.reminderID ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      }
      await database.calendarEvent.add(row)
      set(function (state) {
        return { events: [...state.events, row] }
      })
      return row.id
    },

    async toRemoveEvent(key) {
      await database.calendarEvent.delete(key)
      set(function (state) {
        return {
          events: state.events.filter(function (event) {
            return event.id !== key
          })
        }
      })
    }
  }
})

export { useCalendarStore }
export type { Calendar, CalendarRead }
