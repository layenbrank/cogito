import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

interface Calendar {
  id: string
  title: string
  notes: string
  startAt: number
  endAt: number
  entireDay: boolean
  color: string | null
  reminderID: string | null
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface CalendarWrite {
  title: string
  notes?: string
  startAt: number
  endAt: number
  entireDay?: boolean
  color?: string | null
  reminderID?: string | null
}

interface CalendarChange {
  title?: string
  notes?: string
  startAt?: number
  endAt?: number
  entireDay?: boolean
  color?: string | null
  reminderID?: string | null
  archivedAt?: number | null
}

interface CalendarUpdate {
  key: string
  change: CalendarChange
}

interface CalendarRead {
  id?: string
  title?: string
  reminderID?: string
  archived?: boolean
  rangeFrom?: number
  rangeTo?: number
}

interface CalendarStore {
  events: Calendar[]
  loaded: boolean
  /* 属性式函数签名：动作会被 select 出来单独引用，写成方法会带上 this */
  toReadEvents: (filter?: CalendarRead) => Promise<Calendar[]>
  toWriteEvent: (value: CalendarWrite) => Promise<string | undefined>
  toUpdateEvent: (value: CalendarUpdate) => Promise<void>
  toRemoveEvent: (key: string) => Promise<void>
}

const useCalendarStore = create<CalendarStore>()(
  devtools(
    immer(function (setter) {
      return {
        events: [],
        loaded: false,

        async toReadEvents(filter = {}) {
          try {
            const events = await invoke<Calendar[]>(CHANNELS.CALENDAR.READ, {
              params: filter
            })
            setter(
              function (state) {
                state.events = events
                state.loaded = true
              },
              false,
              'toReadEvents'
            )
            return events
          } catch (err) {
            reportCaught('calendar-store.toReadEvents', err)
            setter(
              function (state) {
                state.loaded = true
              },
              false,
              'toReadEvents/error'
            )
            return []
          }
        },

        async toWriteEvent(value) {
          try {
            const ids = await invoke<string[]>(CHANNELS.CALENDAR.WRITE, { params: value })
            return ids[0]
          } catch (err) {
            reportCaught('calendar-store.toWriteEvent', err)
            return undefined
          }
        },

        async toUpdateEvent(value) {
          try {
            await invoke(CHANNELS.CALENDAR.UPDATE, { params: value })
          } catch (err) {
            reportCaught('calendar-store.toUpdateEvent', err)
          }
        },

        async toRemoveEvent(key) {
          try {
            await invoke(CHANNELS.CALENDAR.REMOVE, { params: key })
          } catch (err) {
            reportCaught('calendar-store.toRemoveEvent', err)
          }
        }
      }
    }),
    { name: 'calendar-store' }
  )
)

export { useCalendarStore }
export type { Calendar, CalendarChange, CalendarRead, CalendarUpdate, CalendarWrite }
