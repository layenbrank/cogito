/**
 * 磁贴交互偏好：委托 `persist` 的 `tiles` 命名空间（tiles.json）。
 */
import { ensurePersist, findPref, patchPref } from '@/features/persist'
import type {
  CodeChrome,
  MarkdownChrome,
  TileSessionPref,
  TilesPref
} from '@/features/persist'

type CodePreferences = CodeChrome
type MarkdownTilePreferences = MarkdownChrome

interface SignboardPreferences {
  activeBoardID: string | null
}

async function ensureTilePrefs(): Promise<void> {
  await ensurePersist()
}

function findTileSessions(): TileSessionPref[] {
  return findPref('tiles').sessions
}

function findSessionPath(component: MagneticTile.Component): string | null {
  const hit = findPref('tiles').sessions.find(function (session) {
    return session.component === component
  })
  return hit?.path ?? null
}

async function persistTileSessions(sessions: TileSessionPref[]): Promise<void> {
  await patchPref('tiles', { sessions })
}

function findMarkdownTilePrefs(): MarkdownTilePreferences {
  return findPref('tiles').markdown
}

async function persistMarkdownTilePrefs(prefs: MarkdownTilePreferences): Promise<void> {
  await patchPref('tiles', { markdown: prefs })
}

function findCodeTilePrefs(): CodePreferences {
  return findPref('tiles').code
}

async function persistCodeTilePrefs(prefs: CodePreferences): Promise<void> {
  await patchPref('tiles', { code: prefs })
}

function findSignboardTilePrefs(): SignboardPreferences {
  return { activeBoardID: findPref('tiles').signboard.activeBoardID }
}

async function persistSignboardTilePrefs(prefs: SignboardPreferences): Promise<void> {
  await patchPref('tiles', {
    signboard: {
      ...findPref('tiles').signboard,
      activeBoardID: prefs.activeBoardID
    }
  })
}

function findTilesPref(): TilesPref {
  return findPref('tiles')
}

export type {
  TileSessionPref,
  MarkdownTilePreferences,
  CodePreferences,
  SignboardPreferences,
  TilesPref
}

export {
  ensureTilePrefs,
  findTileSessions,
  findSessionPath,
  persistTileSessions,
  findMarkdownTilePrefs,
  persistMarkdownTilePrefs,
  findCodeTilePrefs,
  persistCodeTilePrefs,
  findSignboardTilePrefs,
  persistSignboardTilePrefs,
  findTilesPref
}
