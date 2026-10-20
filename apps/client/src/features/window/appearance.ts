/**
 * 外观：明暗模式 + 主色 + 圆角 + 动效。
 *
 * 设计 token 只认根节点上的 `.dark` 与 `--primary` / `--radius` 两个 CSS 变量，
 * 这里负责读写、持久化（localStorage，启动同步可读，避免首屏闪主题）并套到根节点上。
 * 同时把有效明暗同步到 Tauri `setTheme` / `setEffects`（mica 明暗），与 CSS 主题一致。
 *
 * 动效：不改 OS `prefers-reduced-motion`，只在应用边界写 `data-motion`，
 * 并驱动 MotionConfig / JS 读点，供用户强制开或关。
 */

import { emit } from '@tauri-apps/api/event'
import { Effect, getCurrentWindow, type Theme } from '@tauri-apps/api/window'

const APPEARANCE_KEY = 'client.appearance'

/** 独立设置窗写入后通知主窗口。主窗口里的磁贴不再逐窗广播。 */
const APPEARANCE_SYNC = 'appearance://sync'

const APPEARANCE_MODES = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

/** 动效：跟随系统 / 始终开 / 减少（应用边界，不改 OS） */
const MOTION_PRESETS = [
  { value: 'system', label: '跟随系统' },
  { value: 'on', label: '开启动效' },
  { value: 'off', label: '减少动效' }
] as const

/** 主色预设：前景色与主色成对给出，避免浅色主色压深底产生对比不足 */
const PRIMARY_PRESETS = [
  { label: '品牌蓝', value: '#4080ff', foreground: '#ffffff' },
  { label: '靛青', value: '#4f46e5', foreground: '#ffffff' },
  { label: '青绿', value: '#0d9488', foreground: '#ffffff' },
  { label: '琥珀', value: '#d97706', foreground: '#ffffff' },
  { label: '玫红', value: '#e11d48', foreground: '#ffffff' },
  { label: '石墨', value: '#334155', foreground: '#ffffff' }
] as const

/** 圆角预设：设计 token 的 `--radius` 由此驱动，radius-sm…4xl 自动派生 */
const RADIUS_PRESETS = [
  { label: '直角', value: 0 },
  { label: '小', value: 6 },
  { label: '中', value: 10 },
  { label: '大', value: 14 }
] as const

const RADIUS_RANGE = {
  min: RADIUS_PRESETS[0].value,
  max: RADIUS_PRESETS[RADIUS_PRESETS.length - 1].value
} as const

type AppearanceMode = (typeof APPEARANCE_MODES)[number]['value']
type MotionPreference = (typeof MOTION_PRESETS)[number]['value']
type EffectiveMotion = 'full' | 'reduce'
type MotionConfigValue = 'user' | 'always' | 'never'

interface Appearance {
  mode: AppearanceMode
  motion: MotionPreference
  color: string
  foreground: string
  radius: number
}

const DEFAULT_APPEARANCE: Appearance = {
  mode: 'system',
  motion: 'system',
  color: PRIMARY_PRESETS[0].value,
  foreground: PRIMARY_PRESETS[0].foreground,
  radius: 10
}

const listeners = new Set<() => void>()

/** useSyncExternalStore 要求 getSnapshot 返回稳定引用，禁止每次 new 对象 */
let cachedAppearance: Appearance | null = null

function notifyAppearance() {
  for (const listener of listeners) listener()
}

function subscribeAppearance(listener: () => void) {
  listeners.add(listener)
  return function () {
    listeners.delete(listener)
  }
}

function loadAppearance(): Appearance {
  if (typeof localStorage === 'undefined') return DEFAULT_APPEARANCE
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY)
    return raw ? parseAppearance(JSON.parse(raw)) : DEFAULT_APPEARANCE
  } catch (error) {
    console.warn('[appearance] 读不到外观配置', error)
    return DEFAULT_APPEARANCE
  }
}

function rememberAppearance(next: Appearance) {
  cachedAppearance = next
  return next
}

function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return DEFAULT_APPEARANCE

  const input = value as Partial<Appearance>
  const mode = APPEARANCE_MODES.some(function (item) {
    return item.value === input.mode
  })
    ? (input.mode as AppearanceMode)
    : DEFAULT_APPEARANCE.mode
  const motion = MOTION_PRESETS.some(function (item) {
    return item.value === input.motion
  })
    ? (input.motion as MotionPreference)
    : DEFAULT_APPEARANCE.motion
  const preset = PRIMARY_PRESETS.find(function (item) {
    return item.value === input.color
  })

  return {
    mode,
    motion,
    color: preset ? preset.value : DEFAULT_APPEARANCE.color,
    foreground: preset ? preset.foreground : DEFAULT_APPEARANCE.foreground,
    radius:
      typeof input.radius === 'number' && Number.isFinite(input.radius)
        ? Math.min(RADIUS_RANGE.max, Math.max(RADIUS_RANGE.min, input.radius))
        : DEFAULT_APPEARANCE.radius
  }
}

function isDarkMode(mode: AppearanceMode) {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function hasOsReducedMotion() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 应用边界有效动效：跟随系统时读 OS，否则强制开/关 */
function findEffectiveMotion(motion: MotionPreference): EffectiveMotion {
  if (motion === 'on') return 'full'
  if (motion === 'off') return 'reduce'
  return hasOsReducedMotion() ? 'reduce' : 'full'
}

/** 是否应按「减少动效」处理（JS / CSS 统一读点） */
function findReducedMotion() {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-motion')
    if (attr === 'reduce') return true
    if (attr === 'full') return false
  }
  return findEffectiveMotion(readAppearance().motion) === 'reduce'
}

/** Motion `reducedMotion`：on→never / off→always / system→user */
function findMotionConfig(motion: MotionPreference): MotionConfigValue {
  if (motion === 'on') return 'never'
  if (motion === 'off') return 'always'
  return 'user'
}

/** 建窗 / setTheme：跟随系统时传 null */
function findWindowTheme(mode: AppearanceMode): Theme | null {
  if (mode === 'system') return null
  return mode === 'dark' ? 'dark' : 'light'
}

/**
 * 建窗 / setEffects：按有效明暗优先 mica 变体。
 * JS `Effect` 枚举（api@2.11）只有 `Mica`，但 Rust/配置侧认 `micaDark`/`micaLight`，
 * 用字面量传参；勿写 `Effect.MicaDark`（运行时为 undefined，建窗会直接失败）。
 */
function findWindowEffects(isDark: boolean) {
  return {
    effects: (
      isDark
        ? ['micaDark', Effect.Mica, Effect.Acrylic]
        : ['micaLight', Effect.Mica, Effect.Acrylic]
    ) as Effect[]
  }
}

function syncNativeWindow(appearance: Appearance) {
  if (typeof window === 'undefined') return
  // 非 Tauri 环境（浏览器预览）没有原生窗 API
  if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return

  const isDark = isDarkMode(appearance.mode)
  const theme = findWindowTheme(appearance.mode)
  const effects = findWindowEffects(isDark)

  void getCurrentWindow()
    .setTheme(theme)
    .catch(function (error: unknown) {
      console.warn('[appearance] setTheme 失败', error)
    })

  void getCurrentWindow()
    .setEffects(effects)
    .catch(function (error: unknown) {
      console.warn('[appearance] setEffects 失败', error)
    })
}

/** 只把外观套到当前文档。子 WebView 用它：它没有自己的窗口，不能去改材质。 */
function paintDocument() {
  if (typeof document === 'undefined') return
  const appearance = readAppearance()
  const root = document.documentElement
  root.classList.toggle('dark', isDarkMode(appearance.mode))
  root.dataset.motion = findEffectiveMotion(appearance.motion)
  root.style.setProperty('--primary', appearance.color)
  root.style.setProperty('--primary-foreground', appearance.foreground)
  root.style.setProperty('--radius', `${appearance.radius}px`)
}

function applyAppearance(appearance: Appearance) {
  if (typeof document === 'undefined') return

  paintDocument()
  syncNativeWindow(appearance)
  notifyAppearance()
}

function readAppearance(): Appearance {
  if (cachedAppearance) return cachedAppearance
  return rememberAppearance(loadAppearance())
}

/** MotionConfig 用：原始字符串，Object.is 稳定，可直接作 getSnapshot */
function readMotionConfig(): MotionConfigValue {
  return findMotionConfig(readAppearance().motion)
}

function storeAppearance(next: Appearance) {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next))
  } catch (error) {
    console.warn('[appearance] 写不了外观配置', error)
  }
}

function isTauriWindow() {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
}

function publishAppearance(appearance: Appearance) {
  if (!isTauriWindow()) return
  void emit(APPEARANCE_SYNC, appearance).catch(function (error: unknown) {
    console.warn('[appearance] 通知主窗口失败', error)
  })
}

function writeAppearance(patch: Partial<Appearance>) {
  const next = rememberAppearance(parseAppearance({ ...readAppearance(), ...patch }))
  storeAppearance(next)
  watchAppearance()
  publishAppearance(next)
  return next
}

/** 主窗口收到独立设置窗的通知后套用，不再向外广播。 */
function adoptAppearance(raw: unknown) {
  const next = rememberAppearance(parseAppearance(raw))
  storeAppearance(next)
  watchAppearance()
  return next
}

function resetAppearance() {
  try {
    localStorage.removeItem(APPEARANCE_KEY)
  } catch (error) {
    console.warn('[appearance] 重置外观配置失败', error)
  }
  rememberAppearance(DEFAULT_APPEARANCE)
  watchAppearance()
  publishAppearance(DEFAULT_APPEARANCE)
  return DEFAULT_APPEARANCE
}

let stopWatch: (() => void) | null = null

/** 启动时套一次；跟随系统的明暗 / 动效继续听 OS 变化 */
function watchAppearance() {
  stopWatch?.()
  stopWatch = null
  if (typeof window === 'undefined') return

  const appearance = readAppearance()
  applyAppearance(appearance)

  const cleanups: Array<() => void> = []

  if (appearance.mode === 'system') {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    function onColorScheme() {
      if (readAppearance().mode === 'system') applyAppearance(readAppearance())
    }
    colorScheme.addEventListener('change', onColorScheme)
    cleanups.push(function () {
      colorScheme.removeEventListener('change', onColorScheme)
    })
  }

  if (appearance.motion === 'system') {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    function onReducedMotion() {
      if (readAppearance().motion === 'system') applyAppearance(readAppearance())
    }
    reduced.addEventListener('change', onReducedMotion)
    cleanups.push(function () {
      reduced.removeEventListener('change', onReducedMotion)
    })
  }

  if (cleanups.length === 0) return
  stopWatch = function () {
    for (const cleanup of cleanups) cleanup()
  }
}

export {
  APPEARANCE_MODES,
  APPEARANCE_SYNC,
  DEFAULT_APPEARANCE,
  MOTION_PRESETS,
  PRIMARY_PRESETS,
  RADIUS_PRESETS,
  adoptAppearance,
  findEffectiveMotion,
  findMotionConfig,
  findReducedMotion,
  findWindowEffects,
  findWindowTheme,
  isDarkMode,
  paintDocument,
  readAppearance,
  readMotionConfig,
  resetAppearance,
  subscribeAppearance,
  watchAppearance,
  writeAppearance
}
export type { Appearance, AppearanceMode, EffectiveMotion, MotionConfigValue, MotionPreference }
