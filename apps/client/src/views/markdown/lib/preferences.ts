import {
  findMarkdownTilePrefs,
  persistMarkdownTilePrefs
} from '@/features/magnetic-tile/tile-prefs'
import type { MarkdownViewMode } from '@/views/markdown/lib/types.ts'

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

/** 同步读：依赖 ensurePersist 后的 tiles cache */
function parsePreferences(): MarkdownPreferences {
  try {
    return findMarkdownTilePrefs()
  } catch (error) {
    console.warn('[markdown] parsePreferences failed', error)
    return { ...PREFERENCES, recentPaths: [] }
  }
}

function hydratePreferencesFromStore(): MarkdownPreferences {
  return findMarkdownTilePrefs()
}

function persistPreferences(prefs: MarkdownPreferences): void {
  void persistMarkdownTilePrefs(prefs)
}

export type { MarkdownPreferences }
export {
  PREFERENCES,
  parsePreferences,
  hydratePreferencesFromStore,
  persistPreferences
}
