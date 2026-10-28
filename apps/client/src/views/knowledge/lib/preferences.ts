import {
  findKnowledgeTilePrefs,
  persistKnowledgeTilePrefs
} from '@/features/magnetic-tile/tile-prefs'
import type { KnowledgeViewMode } from '@/views/knowledge/lib/types.ts'

interface KnowledgePreferences {
  isSidebarOpen: boolean
  isOutlineOpen: boolean
  viewMode: KnowledgeViewMode
  fontSize: number
  contentMaxWidth: number
  autosaveMs: number
  isTypographyEnabled: boolean
  isFocusMode: boolean
  isTypewriter: boolean
  recentPaths: string[]
  workspaceRoot: string | null
}

/** isSidebarOpen = 左栏；isOutlineOpen = 右栏（大纲|AI 共用） */
const PREFERENCES: KnowledgePreferences = {
  isSidebarOpen: true,
  isOutlineOpen: true,
  viewMode: 'live',
  fontSize: 16,
  contentMaxWidth: 760,
  autosaveMs: 3000,
  isTypographyEnabled: true,
  isFocusMode: false,
  isTypewriter: false,
  recentPaths: [],
  workspaceRoot: null
}

/** 同步读：依赖 ensurePersist 后的 tiles cache */
function parsePreferences(): KnowledgePreferences {
  try {
    return findKnowledgeTilePrefs()
  } catch (error) {
    console.warn('[knowledge] parsePreferences failed', error)
    return { ...PREFERENCES, recentPaths: [], workspaceRoot: null }
  }
}

function hydratePreferencesFromStore(): KnowledgePreferences {
  return findKnowledgeTilePrefs()
}

function persistPreferences(prefs: KnowledgePreferences): void {
  void persistKnowledgeTilePrefs(prefs)
}

export type { KnowledgePreferences }
export {
  PREFERENCES,
  parsePreferences,
  hydratePreferencesFromStore,
  persistPreferences
}
