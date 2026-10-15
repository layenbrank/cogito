import { LazyStore } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

import { syncAutostart } from '@/features/magnetic-tiles/settings/autostart'

declare namespace Setting {
  export interface General {
    autostart: boolean
    language: string
  }

  export type CaptureDetect = 'off' | 'window'

  export interface RetentionPolicy {
    days: number
    count: number
    maxBytes: number
  }

  export interface CaptureRetention {
    screenshot: RetentionPolicy
    recording: RetentionPolicy
  }

  export interface Capture {
    detect: CaptureDetect
    shortcut: string
    isRetentionEnabled: boolean
    retention: CaptureRetention
  }

  export interface Composite {
    general: General
    capture: Capture
  }
}

const DETECT_OFF: Setting.CaptureDetect = 'off'
const DETECT_WINDOW: Setting.CaptureDetect = 'window'

const SCREENSHOT_RETENTION: Setting.RetentionPolicy = {
  days: 7,
  count: 100,
  maxBytes: 500 * 1024 * 1024
}

const RECORDING_RETENTION: Setting.RetentionPolicy = {
  days: 30,
  count: 50,
  maxBytes: 5 * 1024 * 1024 * 1024
}

const CAPTURE: Setting.Capture = {
  detect: DETECT_WINDOW,
  shortcut: 'Alt+Q',
  isRetentionEnabled: true,
  retention: {
    screenshot: { ...SCREENSHOT_RETENTION },
    recording: { ...RECORDING_RETENTION }
  }
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

function mergeRetentionPolicy(
  base: Setting.RetentionPolicy,
  patch?: Partial<Setting.RetentionPolicy>
): Setting.RetentionPolicy {
  if (!patch) return { ...base }
  return { ...base, ...patch }
}

function mergeCapture(stored?: Partial<Setting.Capture>): Setting.Capture {
  if (!stored) {
    return {
      ...CAPTURE,
      retention: {
        screenshot: { ...SCREENSHOT_RETENTION },
        recording: { ...RECORDING_RETENTION }
      }
    }
  }
  return {
    ...CAPTURE,
    ...stored,
    retention: {
      screenshot: mergeRetentionPolicy(SCREENSHOT_RETENTION, stored.retention?.screenshot),
      recording: mergeRetentionPolicy(RECORDING_RETENTION, stored.retention?.recording)
    }
  }
}

function mergeCaptureUpdate(
  current: Setting.Capture,
  patch: Partial<Setting.Capture>
): Setting.Capture {
  return {
    ...current,
    ...patch,
    retention: patch.retention
      ? {
          screenshot: mergeRetentionPolicy(
            current.retention.screenshot,
            patch.retention.screenshot
          ),
          recording: mergeRetentionPolicy(current.retention.recording, patch.retention.recording)
        }
      : current.retention
  }
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
        if (val === undefined) continue
        if (key === 'capture') {
          settings.capture = mergeCapture(val as Partial<Setting.Capture>)
        } else {
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
      let merged: Setting.Composite[typeof section]

      if (section === 'capture') {
        merged = mergeCaptureUpdate(
          current.capture,
          value as Partial<Setting.Capture>
        ) as Setting.Composite[typeof section]
      } else {
        merged = { ...current[section], ...value }
      }

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

export {
  DETECT_OFF,
  DETECT_WINDOW,
  RECORDING_RETENTION,
  SCREENSHOT_RETENTION,
  mergeCapture,
  mergeCaptureUpdate
}
