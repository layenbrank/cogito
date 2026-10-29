import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

import { findPref, patchPref, type ClockStyle } from '@/features/persist'
import { CHANNELS } from '@/shared/ipc/channels'
import { reportCaught } from '@/utils/exception-report'

export type { ClockStyle }

function findClockStyle(): ClockStyle {
  return findPref('window').clockStyle
}

// CountdownConfig — countdown work settings only, no clockStyle
export interface CountdownConfig {
  id: string
  workStart: string // "HH:MM"
  workEnd: string // "HH:MM"
  workDays: string // JSON array string e.g. "[1,2,3,4,5]" (1=Mon, 7=Sun)
  monthlySalary: number
  payDay: number // 1–31
  createdAt: number
  updatedAt: number
}

export interface CountdownUpdate {
  workStart?: string
  workEnd?: string
  workDays?: string
  monthlySalary?: number
  payDay?: number
}

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

interface ClockStore {
  config: CountdownConfig
  clockStyle: ClockStyle
  loaded: boolean
  initialize: () => Promise<void>
  updateConfig: (update: CountdownUpdate) => Promise<void>
  updateClockStyle: (style: ClockStyle) => void
}

export const useClockStore = create<ClockStore>()(
  devtools(
    immer(function (setter, getter) {
      return {
        config: COUNTDOWN_CONFIG,
        clockStyle: findClockStyle(),
        loaded: false,

        async initialize() {
          if (getter().loaded) return
          try {
            const config = await invoke<CountdownConfig | null>(CHANNELS.COUNTDOWN.READ)
            setter(function (state) {
              state.config = config ?? COUNTDOWN_CONFIG
              state.clockStyle = findClockStyle()
              state.loaded = true
            })
          } catch (e) {
            reportCaught('clock-store.initialize', e, 'warning')
            setter(function (state) {
              state.clockStyle = findClockStyle()
              state.loaded = true
            })
          }
        },

        async updateConfig(update: CountdownUpdate) {
          const prev = { ...getter().config }
          // Optimistic update
          setter(function (state) {
            Object.assign(state.config, update)
          })
          try {
            await invoke(CHANNELS.COUNTDOWN.UPDATE, { params: update })
          } catch (e) {
            // Rollback on failure
            setter(function (state) {
              state.config = prev
            })
            reportCaught('clock-store.updateConfig', e)
            throw e
          }
        },

        updateClockStyle(style: ClockStyle) {
          setter(function (state) {
            state.clockStyle = style
          })
          void patchPref('window', { clockStyle: style })
        }
      }
    }),
    { name: 'clock-store' }
  )
)
