import { create } from 'zustand'

import { ensurePersist, findPref, patchPref, replacePref } from '@/features/persist'
import { syncAutostart } from '@/features/magnetic-tiles/settings/autostart'

declare namespace Setting {
  export interface General {
    autostart: boolean
    language: string
  }

  /**
   * 截屏吸附粒度：`off` 自由框选 / `window` 窗口与子控件 / `element` 再加元素级
   */
  export type CaptureDetect = 'off' | 'window' | 'element'

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
    isRetentionEnabled: boolean
    retention: CaptureRetention
  }

  /**
   * 快捷键覆盖值：**只存用户改过的**。
   *
   * 默认值永远来自 `keyboard/definitions.ts` 的唯一键位表 —— 以后改代码里的默认键位，
   * 没改过的用户自动跟随，改过的保留。
   */
  export interface Shortcuts {
    version: number
    /** 键位 id → DSL 串，如 `capture.screenshot` → `Alt+Q` */
    bindings: Record<string, string>
  }

  export interface Composite {
    general: General
    capture: Capture
    shortcuts: Shortcuts
  }
}

const DETECT_OFF: Setting.CaptureDetect = 'off'
const DETECT_WINDOW: Setting.CaptureDetect = 'window'
const DETECT_ELEMENT: Setting.CaptureDetect = 'element'

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

const SHORTCUTS_VERSION = 1

const CAPTURE: Setting.Capture = {
  detect: DETECT_ELEMENT,
  isRetentionEnabled: true,
  retention: {
    screenshot: { ...SCREENSHOT_RETENTION },
    recording: { ...RECORDING_RETENTION }
  }
}

const GENERAL: Setting.General = {
  autostart: true,
  language: 'zh-CN'
}

/** 每次给一份新对象：避免 `toReset` / `toInitialize` 共享同一份默认值被就地改到 */
function makeSettings(): Setting.Composite {
  return {
    general: { ...GENERAL },
    capture: mergeCapture(),
    shortcuts: { version: SHORTCUTS_VERSION, bindings: {} }
  }
}

interface SettingsStore {
  settings: Setting.Composite
  loaded: boolean
  toInitialize: () => Promise<void>
  toUpdate: <K extends keyof Setting.Composite>(
    section: K,
    value: Partial<Setting.Composite[K]>
  ) => Promise<void>
  /** 写入 / 清除某个键位的用户覆盖；`null` = 恢复默认 */
  toSetBinding: (id: string, binding: string | null) => Promise<void>
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
      detect: CAPTURE.detect,
      isRetentionEnabled: CAPTURE.isRetentionEnabled,
      retention: {
        screenshot: { ...SCREENSHOT_RETENTION },
        recording: { ...RECORDING_RETENTION }
      }
    }
  }
  // 逐字段取而不是展开：好让 v0 的 `shortcut` 这类已迁走的字段自然而然落不下来
  return {
    detect: stored.detect ?? CAPTURE.detect,
    isRetentionEnabled: stored.isRetentionEnabled ?? CAPTURE.isRetentionEnabled,
    retention: {
      screenshot: mergeRetentionPolicy(SCREENSHOT_RETENTION, stored.retention?.screenshot),
      recording: mergeRetentionPolicy(RECORDING_RETENTION, stored.retention?.recording)
    }
  }
}

/** 归一化存盘的覆盖表：丢掉非字符串与空值 */
function mergeShortcuts(stored?: Partial<Setting.Shortcuts>): Setting.Shortcuts {
  const bindings: Record<string, string> = {}
  for (const [id, binding] of Object.entries(stored?.bindings ?? {})) {
    if (typeof binding === 'string' && binding.trim()) bindings[id] = binding
  }
  return { version: SHORTCUTS_VERSION, bindings }
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
    settings: makeSettings(),
    loaded: false,

    async toInitialize() {
      if (getter().loaded) return
      await ensurePersist()
      const stored = findPref('settings')
      const settings: Setting.Composite = {
        general: { ...GENERAL, ...stored.general },
        capture: mergeCapture(stored.capture),
        shortcuts: mergeShortcuts(stored.shortcuts)
      }

      try {
        const enabled = await syncAutostart(settings.general.autostart)
        settings.general = { ...settings.general, autostart: enabled }
      } catch (error) {
        console.warn('[settings] syncAutostart on init failed', error)
      }

      await replacePref('settings', settings)
      setter({ settings, loaded: true })
    },

    async toUpdate(section, value) {
      const current = getter().settings
      let merged: Setting.Composite[typeof section]

      if (section === 'capture') {
        merged = mergeCaptureUpdate(
          current.capture,
          value
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

      const next = { ...current, [section]: merged }
      setter({ settings: next })
      await patchPref('settings', { [section]: merged })
    },

    async toSetBinding(id, binding) {
      const current = getter().settings
      const bindings = { ...current.shortcuts.bindings }
      if (binding && binding.trim()) bindings[id] = binding
      else delete bindings[id]

      const next: Setting.Shortcuts = { version: SHORTCUTS_VERSION, bindings }
      setter({ settings: { ...current, shortcuts: next } })
      await patchPref('settings', { shortcuts: next })
    },

    async toReset() {
      const settings = makeSettings()
      setter({ settings })
      await replacePref('settings', settings)
      try {
        await syncAutostart(settings.general.autostart)
      } catch (error) {
        console.warn('[settings] syncAutostart on reset failed', error)
      }
    }
  }
})

export {
  DETECT_OFF,
  DETECT_WINDOW,
  DETECT_ELEMENT,
  RECORDING_RETENTION,
  SCREENSHOT_RETENTION,
  SHORTCUTS_VERSION,
  mergeCapture,
  mergeCaptureUpdate,
  mergeShortcuts
}
export type { Setting }
