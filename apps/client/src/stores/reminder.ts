import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

interface Reminder {
  id: string
  title: string
  notes: string
  dueAt: number | null
  endAt: number | null
  fireTime: string | null
  weekDays: string
  entireDay: boolean
  enabled: boolean
  snoozeUntil: number | null
  lastFiredAt: number | null
  priority: number
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

interface ReminderWrite {
  title: string
  notes?: string
  dueAt?: number | null
  endAt?: number | null
  fireTime?: string | null
  weekDays?: string
  entireDay?: boolean
  enabled?: boolean
  snoozeUntil?: number | null
  priority?: number
}

interface ReminderChange {
  title?: string
  notes?: string
  dueAt?: number | null
  endAt?: number | null
  fireTime?: string | null
  weekDays?: string
  entireDay?: boolean
  enabled?: boolean
  snoozeUntil?: number | null
  priority?: number
  archivedAt?: number | null
}

interface ReminderUpdate {
  key: string
  change: ReminderChange
}

interface ReminderRead {
  id?: string
  title?: string
  enabled?: boolean
  archived?: boolean
  dueFrom?: number
  dueTo?: number
}

interface ReminderStore {
  reminders: Reminder[]
  loaded: boolean
  /* 属性式函数签名：动作会被 select 出来单独引用，写成方法会带上 this */
  toReadReminders: (filter?: ReminderRead) => Promise<Reminder[]>
  toWriteReminder: (value: ReminderWrite) => Promise<string | undefined>
  toUpdateReminder: (value: ReminderUpdate) => Promise<void>
  toRemoveReminder: (key: string) => Promise<void>
}

const useReminderStore = create<ReminderStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        reminders: [],
        loaded: false,

        async toReadReminders(filter = {}) {
          try {
            const reminders = await invoke<Reminder[]>(CHANNELS.REMINDER.READ, {
              params: filter
            })
            setter(
              function (state) {
                state.reminders = reminders
                state.loaded = true
              },
              false,
              'toReadReminders'
            )
            return reminders
          } catch (err) {
            reportCaught('reminder-store.toReadReminders', err)
            setter(
              function (state) {
                state.loaded = true
              },
              false,
              'toReadReminders/error'
            )
            return []
          }
        },

        async toWriteReminder(value) {
          try {
            const ids = await invoke<string[]>(CHANNELS.REMINDER.WRITE, {
              params: {
                title: value.title,
                notes: value.notes ?? '',
                dueAt: value.dueAt ?? null,
                endAt: value.endAt ?? null,
                fireTime: value.fireTime ?? null,
                weekDays: value.weekDays ?? '[]',
                entireDay: value.entireDay ?? false,
                enabled: value.enabled ?? true,
                snoozeUntil: value.snoozeUntil ?? null,
                priority: value.priority ?? 0
              }
            })
            await getter().toReadReminders()
            return ids[0]
          } catch (err) {
            reportCaught('reminder-store.toWriteReminder', err)
            return undefined
          }
        },

        async toUpdateReminder(value) {
          const prev = getter().reminders
          setter(
            function (state) {
              const target = state.reminders.find(function (r) {
                return r.id === value.key
              })
              if (!target) return
              Object.assign(target, value.change)
            },
            false,
            'toUpdateReminder/optimistic'
          )
          try {
            await invoke(CHANNELS.REMINDER.UPDATE, { params: value })
            await getter().toReadReminders()
          } catch (err) {
            setter(
              function (state) {
                state.reminders = prev
              },
              false,
              'toUpdateReminder/rollback'
            )
            reportCaught('reminder-store.toUpdateReminder', err)
            throw err
          }
        },

        async toRemoveReminder(key) {
          const prev = getter().reminders
          setter(
            function (state) {
              state.reminders = state.reminders.filter(function (r) {
                return r.id !== key
              })
            },
            false,
            'toRemoveReminder/optimistic'
          )
          try {
            await invoke(CHANNELS.REMINDER.REMOVE, { params: key })
          } catch (err) {
            setter(
              function (state) {
                state.reminders = prev
              },
              false,
              'toRemoveReminder/rollback'
            )
            reportCaught('reminder-store.toRemoveReminder', err)
            throw err
          }
        }
      }
    }),
    { name: 'reminder-store' }
  )
)

export { useReminderStore }
export type { Reminder, ReminderChange, ReminderRead, ReminderUpdate, ReminderWrite }
