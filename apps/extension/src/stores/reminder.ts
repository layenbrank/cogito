import { create } from 'zustand'

import { database, type ReminderRow } from '@/database/database.ts'

type Reminder = ReminderRow

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
  dueFrom?: number
  dueTo?: number
}

interface ReminderState {
  reminders: Reminder[]
  toReadReminders: (filter?: ReminderRead) => Promise<Reminder[]>
  toWriteReminder: (value: ReminderWrite) => Promise<string | undefined>
  toUpdateReminder: (value: ReminderUpdate) => Promise<void>
  toRemoveReminder: (key: string) => Promise<void>
}

function isActive(row: Reminder): boolean {
  return row.archivedAt === null
}

const useReminderStore = create<ReminderState>(function (set) {
  return {
    reminders: [],

    async toReadReminders(filter) {
      const rows = (await database.reminder.toArray()).filter(isActive)
      // 镜像上时钟和日历同时在读。状态保留全部未归档，返回值再按日期收窄。
      set({ reminders: rows })
      if (!filter) return rows
      return rows.filter(function (row) {
        if (filter.dueFrom !== undefined && (row.dueAt === null || row.dueAt < filter.dueFrom)) return false
        if (filter.dueTo !== undefined && (row.dueAt === null || row.dueAt >= filter.dueTo)) return false
        return true
      })
    },

    async toWriteReminder(value) {
      const now = Date.now()
      const row: Reminder = {
        id: crypto.randomUUID(),
        title: value.title.trim() || '提醒',
        notes: value.notes ?? '',
        dueAt: value.dueAt ?? null,
        endAt: value.endAt ?? null,
        fireTime: value.fireTime ?? null,
        weekDays: value.weekDays ?? '[]',
        entireDay: value.entireDay ?? false,
        enabled: value.enabled ?? true,
        snoozeUntil: value.snoozeUntil ?? null,
        lastFiredAt: null,
        priority: value.priority ?? 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      }
      await database.reminder.add(row)
      set(function (state) {
        return { reminders: [...state.reminders, row] }
      })
      return row.id
    },

    async toUpdateReminder(value) {
      const current = await database.reminder.get(value.key)
      if (!current) return
      const next: Reminder = { ...current, ...value.change, updatedAt: Date.now() }
      await database.reminder.put(next)
      set(function (state) {
        return {
          reminders: state.reminders
            .map(function (row) {
              return row.id === next.id ? next : row
            })
            .filter(isActive)
        }
      })
    },

    async toRemoveReminder(key) {
      await database.reminder.delete(key)
      set(function (state) {
        return {
          reminders: state.reminders.filter(function (row) {
            return row.id !== key
          })
        }
      })
    }
  }
})

export { useReminderStore }
export type { Reminder, ReminderRead, ReminderUpdate, ReminderWrite }
