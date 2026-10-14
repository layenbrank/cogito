import type { MarkdownViewMode } from '@/views/markdown/lib/types.ts'

const STORAGE_KEY = 'MARKDOWN_EDITOR_PREFERENCES'

interface MarkdownPreferences {
  rootDir: string | null
  isSidebarOpen: boolean
  isOutlineOpen: boolean
  viewMode: MarkdownViewMode
  fontSize: number
  contentMaxWidth: number
  autosaveMs: number
  isTypographyEnabled: boolean
  isFocusMode: boolean
  isTypewriter: boolean
  recentPaths: string[]
}

const PREFERENCES: MarkdownPreferences = {
  rootDir: null,
  isSidebarOpen: true,
  isOutlineOpen: true,
  viewMode: 'live',
  fontSize: 16,
  contentMaxWidth: 760,
  autosaveMs: 3000,
  isTypographyEnabled: true,
  isFocusMode: false,
  isTypewriter: false,
  recentPaths: []
}

function parsePreferences(): MarkdownPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<MarkdownPreferences>
    return {
      ...PREFERENCES,
      ...parsed,
      recentPaths: Array.isArray(parsed.recentPaths) ? parsed.recentPaths.slice(0, 20) : []
    }
  } catch (error) {
    console.warn('[markdown] parsePreferences failed', error)
    return { ...PREFERENCES }
  }
}

function persistPreferences(prefs: MarkdownPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export type { MarkdownPreferences }
export { PREFERENCES, STORAGE_KEY, parsePreferences, persistPreferences }
