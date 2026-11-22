import { bootstrapAppearance, readAppearance, writeAppearance, type AppearanceMode } from '@/features/appearance/appearance.ts'

export type ThemeName = AppearanceMode

const THEME_EVENT = 'cogito-theme'

function publish(theme: ThemeName): void {
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }))
}

export function subscribeTheme(listener: (theme: ThemeName) => void): () => void {
  function onTheme(event: Event): void {
    const detail = (event as CustomEvent<ThemeName>).detail
    listener(parseTheme(detail))
  }

  window.addEventListener(THEME_EVENT, onTheme)
  return function () {
    window.removeEventListener(THEME_EVENT, onTheme)
  }
}

export function parseTheme(value: unknown): ThemeName {
  if (value === 'light' || value === 'dark' || value === 'system') return value
  return 'system'
}

export function isDarkTheme(theme: ThemeName, prefersDark: boolean): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return prefersDark
}

export { bootstrapAppearance }

export async function writeTheme(theme: ThemeName): Promise<void> {
  writeAppearance({ mode: theme })
  publish(theme)
}

export function findTheme(): ThemeName {
  return readAppearance().mode
}
