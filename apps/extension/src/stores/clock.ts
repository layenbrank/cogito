import { create } from 'zustand'

import { database, type ClockPrefRow } from '@/database/database.ts'

type ClockStyle = ClockPrefRow['clockStyle']

interface CountdownConfig {
  id: string
  workStart: string
  workEnd: string
  workDays: string
  monthlySalary: number
  payDay: number
  createdAt: number
  updatedAt: number
}

interface CountdownUpdate {
  workStart?: string
  workEnd?: string
  workDays?: string
  monthlySalary?: number
  payDay?: number
}

const PREF_ID = 'primary'

const COUNTDOWN_CONFIG: CountdownConfig = {
  id: '00000000-0000-0000-0000-000000000001',
  workStart: '09:00',
  workEnd: '18:00',
  workDays: '[1,2,3,4,5]',
  monthlySalary: 0,
  payDay: 15,
  createdAt: 0,
  updatedAt: 0
}

interface ClockState {
  config: CountdownConfig
  clockStyle: ClockStyle
  loaded: boolean
  initialize: () => Promise<void>
  updateConfig: (update: CountdownUpdate) => Promise<void>
  updateClockStyle: (style: ClockStyle) => void
}

function toConfig(row: ClockPrefRow): CountdownConfig {
  return {
    id: COUNTDOWN_CONFIG.id,
    workStart: row.workStart,
    workEnd: row.workEnd,
    workDays: row.workDays,
    monthlySalary: row.monthlySalary,
    payDay: row.payDay,
    createdAt: row.updatedAt,
    updatedAt: row.updatedAt
  }
}

const useClockStore = create<ClockState>(function (set, get) {
  return {
    config: COUNTDOWN_CONFIG,
    clockStyle: 'analog',
    loaded: false,

    async initialize() {
      if (get().loaded) return
      try {
        const row = await database.clockPref.get(PREF_ID)
        if (!row) {
          set({ loaded: true })
          return
        }
        set({ config: toConfig(row), clockStyle: row.clockStyle, loaded: true })
      } catch (error) {
        console.error('[clock] 读取作息失败', error)
        set({ loaded: true })
      }
    },

    async updateConfig(update) {
      const prev = get()
      const now = Date.now()
      const next: ClockPrefRow = {
        id: PREF_ID,
        clockStyle: prev.clockStyle,
        workStart: update.workStart ?? prev.config.workStart,
        workEnd: update.workEnd ?? prev.config.workEnd,
        workDays: update.workDays ?? prev.config.workDays,
        monthlySalary: update.monthlySalary ?? prev.config.monthlySalary,
        payDay: update.payDay ?? prev.config.payDay,
        updatedAt: now
      }
      set({ config: toConfig(next) })
      try {
        await database.clockPref.put(next)
      } catch (error) {
        console.error('[clock] 保存作息失败', error)
        set({ config: prev.config })
        throw error
      }
    },

    updateClockStyle(style) {
      const prev = get()
      const now = Date.now()
      set({ clockStyle: style })
      void database.clockPref
        .put({
          id: PREF_ID,
          clockStyle: style,
          workStart: prev.config.workStart,
          workEnd: prev.config.workEnd,
          workDays: prev.config.workDays,
          monthlySalary: prev.config.monthlySalary,
          payDay: prev.config.payDay,
          updatedAt: now
        })
        .catch(function (error: unknown) {
          console.error('[clock] 保存表盘失败', error)
          set({ clockStyle: prev.clockStyle })
        })
    }
  }
})

export { useClockStore }
export type { ClockStyle, CountdownConfig }
