import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { reportCaught } from '@/utils/exception-report'

import { GET_CALENDAR_EVENTS, POST_CALENDAR_EVENTS, PATCH_CALENDAR_EVENTS, DELETE_CALENDAR_EVENTS } from '@/apis/calendar'

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
            const events = await GET_CALENDAR_EVENTS<Calendar[]>(filter)
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
            const ids = await POST_CALENDAR_EVENTS<string[]>(value)
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
            return await POST_CALENDAR_EVENTS<string[]>(values)
          } catch (err) {
            reportCaught('calendar-store.toWriteEvents', err)
            throw err
          }
        },

        async toUpdateEvent(value) {
          try {
            await PATCH_CALENDAR_EVENTS(value)
          } catch (err) {
            reportCaught('calendar-store.toUpdateEvent', err)
          }
        },

        async toRemoveEvent(key) {
          try {
            await DELETE_CALENDAR_EVENTS(key)
          } catch (err) {
            reportCaught('calendar-store.toRemoveEvent', err)
          }
        },

        /** 批量删（撤销一次生成的日程） */
        async toRemoveEvents(keys) {
          if (keys.length === 0) return
          try {
            await DELETE_CALENDAR_EVENTS(keys)
          } catch (err) {
            reportCaught('calendar-store.toRemoveEvents', err)
            // 必须冒上去：以前吞在这里，调用点无条件弹「已撤销」
            throw err
          }
        }
      }
    }),
    { name: 'calendar-store' }
  )
)

export { useCalendarStore }
export type { Calendar, CalendarChange, CalendarRead, CalendarUpdate, CalendarWrite }
