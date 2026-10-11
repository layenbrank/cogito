import { LazyStore } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

import { syncAutostart } from '@/features/magnetic-tiles/settings/autostart'

declare namespace Setting {
  export interface General {
    autostart: boolean
    language: string
  }

  export type CaptureDetect = 'off' | 'window'

  export interface Capture {
    detect: CaptureDetect
  }

  export interface Composite {
    general: General
    capture: Capture
  }
}

const DETECT_OFF: Setting.CaptureDetect = 'off'
const DETECT_WINDOW: Setting.CaptureDetect = 'window'

const CAPTURE: Setting.Capture = {
  detect: DETECT_WINDOW
}

const SETTINGS: Setting.Composite = {
  general: {
    autostart: true,
    language: 'zh-CN'
  },
  capture: CAPTURE
}

const settingStore = new LazyStore('settings.json', {
  defaults: SETTINGS as unknown as Record<string, unknown>,
  autoSave: 300
})

interface SettingsStore {
  settings: Setting.Composite
  loaded: boolean
  toInitialize: () => Promise<void>
  toUpdate: <K extends keyof Setting.Composite>(
    section: K,
    value: Partial<Setting.Composite[K]>
  ) => Promise<void>
  toReset: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>(function (setter, getter) {
  return {
    settings: SETTINGS,
    loaded: false,

    async toInitialize() {
      if (getter().loaded) return
      await settingStore.init()

      const settings = { ...SETTINGS }
      const keys = Object.keys(SETTINGS) as (keyof Setting.Composite)[]
      const entries = await Promise.all(
        keys.map(async function (key) {
          const val = await settingStore.get<Setting.Composite[typeof key]>(key)
          return [key, val] as const
        })
      )
      for (const [key, val] of entries) {
        if (val !== undefined) {
          settings[key] = { ...SETTINGS[key], ...val } as never
        }
      }

      try {
        const enabled = await syncAutostart(settings.general.autostart)
        settings.general = { ...settings.general, autostart: enabled }
        await settingStore.set('general', settings.general)
      } catch (error) {
        console.warn('[settings] syncAutostart on init failed', error)
      }

      setter({ settings, loaded: true })
    },

    async toUpdate(section, value) {
      const current = getter().settings
      const merged = { ...current[section], ...value }

      if (section === 'general' && 'autostart' in value) {
        const desired = (value as Partial<Setting.General>).autostart
        if (typeof desired === 'boolean') {
          const enabled = await syncAutostart(desired)
          ;(merged as Setting.General).autostart = enabled
        }
      }

      setter({ settings: { ...current, [section]: merged } })
      await settingStore.set(section, merged)
    },

    async toReset() {
      setter({ settings: SETTINGS })
      await settingStore.reset()
      try {
        await syncAutostart(SETTINGS.general.autostart)
      } catch (error) {
        console.warn('[settings] syncAutostart on reset failed', error)
      }
    }
  }
})

export { DETECT_OFF, DETECT_WINDOW }
