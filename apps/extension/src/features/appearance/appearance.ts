/**
 * 外观：明暗、主色、圆角、动效。只套到文档上的 CSS token，不走桌面窗材质。
 * 先读本地缓存上色，再跟扩展存储对齐。
 */

const STORAGE_KEY = 'cogito.appearance'
const LEGACY_THEME_KEY = 'cogito.theme'

const APPEARANCE_MODES = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
] as const

const MOTION_PRESETS = [
  { value: 'system', label: '跟随系统' },
  { value: 'on', label: '开启动效' },
  { value: 'off', label: '减少动效' }
] as const

const PRIMARY_PRESETS = [
  { label: '品牌蓝', value: '#4080ff', foreground: '#ffffff' },
  { label: '靛青', value: '#4f46e5', foreground: '#ffffff' },
  { label: '青绿', value: '#0d9488', foreground: '#ffffff' },
  { label: '琥珀', value: '#d97706', foreground: '#ffffff' },
  { label: '玫红', value: '#e11d48', foreground: '#ffffff' },
  { label: '石墨', value: '#334155', foreground: '#ffffff' }
] as const

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

interface Appearance {
  mode: AppearanceMode
  motion: MotionPreference
  color: string
  foreground: string
  radius: number
}

const APPEARANCE: Appearance = {
  mode: 'system',
  motion: 'system',
  color: PRIMARY_PRESETS[0].value,
  foreground: PRIMARY_PRESETS[0].foreground,
  radius: 10
}

let cachedAppearance: Appearance | null = null
let stopWatch: (() => void) | null = null

function parseMode(value: unknown): AppearanceMode {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return APPEARANCE.mode
}

function parseAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return APPEARANCE

  const input = value as Partial<Appearance>
  const motion = MOTION_PRESETS.some(function (item) {
    return item.value === input.motion
  })
    ? (input.motion as MotionPreference)
    : APPEARANCE.motion
  const preset = PRIMARY_PRESETS.find(function (item) {
    return item.value === input.color
  })

  return {
    mode: parseMode(input.mode),
    motion,
    color: preset ? preset.value : APPEARANCE.color,
    foreground: preset ? preset.foreground : APPEARANCE.foreground,
    radius:
      typeof input.radius === 'number' && Number.isFinite(input.radius)
        ? Math.min(RADIUS_RANGE.max, Math.max(RADIUS_RANGE.min, input.radius))
        : APPEARANCE.radius
  }
}

function rememberAppearance(next: Appearance): Appearance {
  cachedAppearance = next
  return next
}

function readLocalAppearance(): Appearance | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseAppearance(JSON.parse(raw))
    const legacy = localStorage.getItem(LEGACY_THEME_KEY)
    if (legacy) return parseAppearance({ mode: parseMode(legacy) })
  } catch (error) {
    console.warn('[appearance] 读不到本地外观', error)
  }
  return null
}

function readAppearance(): Appearance {
  if (cachedAppearance) return cachedAppearance
  return rememberAppearance(readLocalAppearance() ?? APPEARANCE)
}

function isDarkMode(mode: AppearanceMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function hasOsReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function findEffectiveMotion(motion: MotionPreference): EffectiveMotion {
  if (motion === 'on') return 'full'
  if (motion === 'off') return 'reduce'
  return hasOsReducedMotion() ? 'reduce' : 'full'
}

function paintDocument(): void {
  if (typeof document === 'undefined') return
  const appearance = readAppearance()
  const root = document.documentElement
  root.classList.toggle('dark', isDarkMode(appearance.mode))
  root.dataset.motion = findEffectiveMotion(appearance.motion)
  root.style.setProperty('--primary', appearance.color)
  root.style.setProperty('--primary-foreground', appearance.foreground)
  root.style.setProperty('--radius', `${appearance.radius}px`)
}

function persistAppearance(next: Appearance): void {
  const raw = JSON.stringify(next)
  localStorage.setItem(STORAGE_KEY, raw)
  localStorage.setItem(LEGACY_THEME_KEY, next.mode)
  void chrome.storage.local.set({ [STORAGE_KEY]: next, [LEGACY_THEME_KEY]: next.mode }).catch(function (error: unknown) {
    console.error('[appearance] 保存外观失败', error)
  })
}

function watchAppearance(): void {
  stopWatch?.()
  stopWatch = null
  if (typeof window === 'undefined') return

  paintDocument()

  const appearance = readAppearance()
  const cleanups: Array<() => void> = []

  if (appearance.mode === 'system') {
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    function onColorScheme(): void {
      if (readAppearance().mode === 'system') paintDocument()
    }
    colorScheme.addEventListener('change', onColorScheme)
    cleanups.push(function () {
      colorScheme.removeEventListener('change', onColorScheme)
    })
  }

  if (appearance.motion === 'system') {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    function onReducedMotion(): void {
      if (readAppearance().motion === 'system') paintDocument()
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

function writeAppearance(patch: Partial<Appearance>): Appearance {
  const next = rememberAppearance(parseAppearance({ ...readAppearance(), ...patch }))
  persistAppearance(next)
  watchAppearance()
  return next
}

function resetAppearance(): Appearance {
  rememberAppearance(APPEARANCE)
  persistAppearance(APPEARANCE)
  watchAppearance()
  return APPEARANCE
}

/** 先用本地缓存上色，再跟扩展存储对齐。 */
function bootstrapAppearance(): void {
  rememberAppearance(readLocalAppearance() ?? APPEARANCE)
  watchAppearance()

  void chrome.storage.local
    .get([STORAGE_KEY, LEGACY_THEME_KEY])
    .then(function (bag) {
      const stored = bag[STORAGE_KEY]
      const legacy = bag[LEGACY_THEME_KEY]
      const next = stored
        ? parseAppearance(stored)
        : parseAppearance({ ...readAppearance(), mode: parseMode(legacy) })
      rememberAppearance(next)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      watchAppearance()
    })
    .catch(function (error: unknown) {
      console.error('[appearance] 读取外观失败', error)
    })
}

export {
  APPEARANCE,
  APPEARANCE_MODES,
  MOTION_PRESETS,
  PRIMARY_PRESETS,
  RADIUS_PRESETS,
  bootstrapAppearance,
  readAppearance,
  resetAppearance,
  watchAppearance,
  writeAppearance
}
export type { Appearance, AppearanceMode, MotionPreference }
