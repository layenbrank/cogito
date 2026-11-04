import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'

import { ensurePersist, findPref, patchPref, replacePref } from '@/features/persist'
import { syncAutostart } from '@/features/magnetic-tiles/settings/autostart'
import { CHANNELS } from '@/shared/ipc/channels'

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

  /** 标注默认样式：工具栏上改的就是这一份，随设置持久化 */
  export interface CaptureStyle {
    color: string
    thickness: number
    filled: boolean
    opacity: number
    fontSize: number
  }

  export interface Capture {
    detect: CaptureDetect
    isRetentionEnabled: boolean
    retention: CaptureRetention
    style: CaptureStyle
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

  export interface Proxy {
    enabled: boolean
    url: string
    bypassLocal: boolean
    acceptInvalidCerts: boolean
  }

  export interface Composite {
    general: General
    capture: Capture
    shortcuts: Shortcuts
    proxy: Proxy
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

const CAPTURE_STYLE: Setting.CaptureStyle = {
  color: '#4080ff',
  thickness: 2,
  filled: false,
  opacity: 1,
  fontSize: 18
}

const CAPTURE: Setting.Capture = {
  detect: DETECT_ELEMENT,
  isRetentionEnabled: true,
  retention: {
    screenshot: { ...SCREENSHOT_RETENTION },
    recording: { ...RECORDING_RETENTION }
  },
  style: { ...CAPTURE_STYLE }
}

const GENERAL: Setting.General = {
  autostart: true,
  language: 'zh-CN'
}

const PROXY: Setting.Proxy = {
  enabled: false,
  url: '',
  bypassLocal: true,
  acceptInvalidCerts: false
}

/** 每次给一份新对象：避免 `toReset` / `toInitialize` 共享同一份默认值被就地改到 */
function makeSettings(): Setting.Composite {
  return {
    general: { ...GENERAL },
    capture: mergeCapture(),
    shortcuts: { version: SHORTCUTS_VERSION, bindings: {} },
    proxy: { ...PROXY }
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

const STYLE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * 样式归一化：逐字段兜底 + clamp。
 *
 * 存盘里可能是旧版本写的、被手工改坏的、或越界的值（线宽 9999 之类），
 * 统一在这里收口，别让坏数据把工具栏渲染搞崩。
 */
function mergeCaptureStyle(stored?: Partial<Setting.CaptureStyle>): Setting.CaptureStyle {
  if (!stored) return { ...CAPTURE_STYLE }
  const color =
    typeof stored.color === 'string' && STYLE_COLOR_PATTERN.test(stored.color)
      ? stored.color
      : CAPTURE_STYLE.color
  return {
    color,
    thickness: Math.round(clampNumber(stored.thickness, 1, 32, CAPTURE_STYLE.thickness)),
    filled: typeof stored.filled === 'boolean' ? stored.filled : CAPTURE_STYLE.filled,
    opacity: clampNumber(stored.opacity, 0, 1, CAPTURE_STYLE.opacity),
    fontSize: Math.round(clampNumber(stored.fontSize, 8, 96, CAPTURE_STYLE.fontSize))
  }
}

function mergeCapture(stored?: Partial<Setting.Capture>): Setting.Capture {
  if (!stored) {
    return {
      detect: CAPTURE.detect,
      isRetentionEnabled: CAPTURE.isRetentionEnabled,
      retention: {
        screenshot: { ...SCREENSHOT_RETENTION },
        recording: { ...RECORDING_RETENTION }
      },
      style: { ...CAPTURE_STYLE }
    }
  }
  // 逐字段取而不是展开：好让 v0 的 `shortcut` 这类已迁走的字段自然而然落不下来
  return {
    detect: stored.detect ?? CAPTURE.detect,
    isRetentionEnabled: stored.isRetentionEnabled ?? CAPTURE.isRetentionEnabled,
    retention: {
      screenshot: mergeRetentionPolicy(SCREENSHOT_RETENTION, stored.retention?.screenshot),
      recording: mergeRetentionPolicy(RECORDING_RETENTION, stored.retention?.recording)
    },
    style: mergeCaptureStyle(stored.style)
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
    style: patch.style
      ? mergeCaptureStyle({ ...current.style, ...patch.style })
      : current.style,
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
        shortcuts: mergeShortcuts(stored.shortcuts),
        proxy: { ...PROXY, ...stored.proxy }
      }

      try {
        const enabled = await syncAutostart(settings.general.autostart)
        settings.general = { ...settings.general, autostart: enabled }
      } catch (error) {
        console.warn('[settings] syncAutostart on init failed', error)
      }

      try {
        await syncProxyEnv(settings.proxy)
      } catch (error) {
        console.warn('[settings] syncProxy on init failed', error)
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

      if (section === 'proxy') {
        try {
          await syncProxyEnv(merged as Setting.Proxy)
        } catch (error) {
          console.warn('[settings] syncProxy on update failed', error)
        }
      }
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

async function syncProxyEnv(proxy: Setting.Proxy): Promise<void> {
  await invoke(CHANNELS.SYSTEM.PROXY_APPLY, { config: proxy })
}

export {
  DETECT_OFF,
  DETECT_WINDOW,
  DETECT_ELEMENT,
  CAPTURE_STYLE,
  RECORDING_RETENTION,
  SCREENSHOT_RETENTION,
  SHORTCUTS_VERSION,
  mergeCapture,
  mergeCaptureStyle,
  mergeCaptureUpdate,
  mergeShortcuts,
  syncProxyEnv
}
export type { Setting }
