import {
  findCodeTilePrefs,
  persistCodeTilePrefs,
  type CodePanelTab,
  type CodePreferences,
  type CodeSidebarView
} from '@/features/magnetic-tile/tile-prefs'

function parseCodePreferences(): CodePreferences {
  return findCodeTilePrefs()
}

function persistCodePreferences(prefs: CodePreferences): void {
  void persistCodeTilePrefs(prefs)
}

export type { CodePreferences, CodeSidebarView, CodePanelTab }
export { parseCodePreferences, persistCodePreferences }
