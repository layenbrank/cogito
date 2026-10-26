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
  toWriteEvents: (values: CalendarWrite[]) => Promise<string[]>
  toUpdateEvent: (value: CalendarUpdate) => Promise<void>
  toRemoveEvent: (key: string) => Promise<void>
  toRemoveEvents: (keys: string[]) => Promise<void>
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

        /** 批量写：一次 invoke 传数组（daemon 侧同一事务，失败整体回滚） */
        async toWriteEvents(values) {
          if (values.length === 0) return []
          try {
            return await invoke<string[]>(CHANNELS.CALENDAR.WRITE, { params: values })
          } catch (err) {
            reportCaught('calendar-store.toWriteEvents', err)
            throw err
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
        },

        /** 批量删（撤销一次生成的日程） */
        async toRemoveEvents(keys) {
          if (keys.length === 0) return
          try {
            await invoke(CHANNELS.CALENDAR.REMOVE, { params: keys })
          } catch (err) {
            reportCaught('calendar-store.toRemoveEvents', err)
          }
        }
      }
    }),
    { name: 'calendar-store' }
  )
)

export { useCalendarStore }
export type { Calendar, CalendarChange, CalendarRead, CalendarUpdate, CalendarWrite }
