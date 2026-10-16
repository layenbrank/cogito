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

/**
 * v0 里唯一可配置的键：`capture.shortcut`，现已迁进 `shortcuts.bindings`。
 *
 * 默认值**故意写死**：迁移是一次性历史逻辑，判断依据应当是当年那个默认值；
 * 跟着键位表走的话，表以后改默认值就会把老用户的默认值误判成「改过」。
 */
const LEGACY_CAPTURE_SHORTCUT_ID = 'capture.screenshot'
const LEGACY_CAPTURE_SHORTCUT_DEFAULT = 'Alt+Q'

const CAPTURE: Setting.Capture = {
  detect: DETECT_WINDOW,
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

const SHORTCUTS: Setting.Shortcuts = {
  version: SHORTCUTS_VERSION,
  bindings: {}
}

const DEFAULT_SETTINGS: Setting.Composite = {
  general: GENERAL,
  capture: CAPTURE,
  shortcuts: SHORTCUTS
}

/** 每次给一份新对象：避免 `toReset` / `toInitialize` 共享同一份默认值被就地改到 */
function createDefaultSettings(): Setting.Composite {
  return {
    general: { ...GENERAL },
    capture: mergeCapture(),
    shortcuts: { version: SHORTCUTS_VERSION, bindings: {} }
  }
}

const settingStore = new LazyStore('settings.json', {
  defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
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

/**
 * v0 → v1：把旧的 `capture.shortcut` 搬成覆盖。
 *
 * 只在「存过且不是当年默认值」时才搬 —— 否则会把默认值误记成「用户改过」，
 * 以后改代码里的默认键位就再也推不动了。
 */
function migrateShortcuts(
  stored: Partial<Setting.Shortcuts> | undefined,
  legacyCaptureShortcut: unknown
): Setting.Shortcuts {
  const shortcuts = mergeShortcuts(stored)
  if (shortcuts.bindings[LEGACY_CAPTURE_SHORTCUT_ID]) return shortcuts
  if (typeof legacyCaptureShortcut !== 'string') return shortcuts
  const legacy = legacyCaptureShortcut.trim()
  if (!legacy || legacy === LEGACY_CAPTURE_SHORTCUT_DEFAULT) return shortcuts
  return {
    version: SHORTCUTS_VERSION,
    bindings: { ...shortcuts.bindings, [LEGACY_CAPTURE_SHORTCUT_ID]: legacy }
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
    settings: createDefaultSettings(),
    loaded: false,

    async toInitialize() {
      if (getter().loaded) return
      await settingStore.init()

      const [general, capture, shortcuts] = await Promise.all([
        settingStore.get<Partial<Setting.General>>('general'),
        // v0 的 `capture.shortcut` 只在迁移时读一次，类型上仍带着它
        settingStore.get<Partial<Setting.Capture> & { shortcut?: unknown }>('capture'),
        settingStore.get<Partial<Setting.Shortcuts>>('shortcuts')
      ])

      const settings: Setting.Composite = {
        general: { ...GENERAL, ...general },
        capture: mergeCapture(capture),
        shortcuts: migrateShortcuts(shortcuts, capture?.shortcut)
      }

      try {
        const enabled = await syncAutostart(settings.general.autostart)
        settings.general = { ...settings.general, autostart: enabled }
        await settingStore.set('general', settings.general)
      } catch (error) {
        console.warn('[settings] syncAutostart on init failed', error)
      }

      // 把迁移结果与归一化后的章节落盘：顺带把 v0 的 `capture.shortcut` 从文件里抹掉，
      // 不让新旧两条路径并存。顺序 await 即可，没必要再包一层 Promise.all
      await settingStore.set('capture', settings.capture)
      await settingStore.set('shortcuts', settings.shortcuts)

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

      setter({ settings: { ...current, [section]: merged } })
      await settingStore.set(section, merged)
    },

    async toSetBinding(id, binding) {
      const current = getter().settings
      const bindings = { ...current.shortcuts.bindings }
      if (binding && binding.trim()) bindings[id] = binding
      else delete bindings[id]

      const next: Setting.Shortcuts = { version: SHORTCUTS_VERSION, bindings }
      setter({ settings: { ...current, shortcuts: next } })
      await settingStore.set('shortcuts', next)
    },

    async toReset() {
      const settings = createDefaultSettings()
      setter({ settings })
      await settingStore.reset()
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
  LEGACY_CAPTURE_SHORTCUT_ID,
  RECORDING_RETENTION,
  SCREENSHOT_RETENTION,
  SHORTCUTS_VERSION,
  mergeCapture,
  mergeCaptureUpdate,
  mergeShortcuts,
  migrateShortcuts
}
