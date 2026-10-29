import {
  findCodeTilePrefs,
  persistCodeTilePrefs,
  type CodePreferences
} from '@/features/magnetic-tile/tile-prefs'
import type { CodeSurfaceTab, CodeSidebarView } from '@/features/persist/types'

function parseCodePreferences(): CodePreferences {
  return findCodeTilePrefs()
}

function persistCodePreferences(prefs: CodePreferences): void {
  void persistCodeTilePrefs(prefs)
}

export type { CodePreferences, CodeSidebarView, CodeSurfaceTab }
export { parseCodePreferences, persistCodePreferences }
