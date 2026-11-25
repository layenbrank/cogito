/**
 * 磁贴交互偏好：委托 `persist` 的 `tiles` 命名空间（tiles.json）。
 */
import { ensurePersist, findPref, patchPref } from '@/features/persist'
import type { CodeShell, KnowledgeShell, TilesPref } from '@/features/persist'

type CodePreferences = CodeShell
type KnowledgeTilePreferences = KnowledgeShell

interface SignboardPreferences {
  activeBoardID: string | null
}

async function ensureTilePrefs(): Promise<void> {
  await ensurePersist()
}

function findKnowledgeTilePrefs(): KnowledgeTilePreferences {
  return findPref('tiles').knowledge
}

async function persistKnowledgeTilePrefs(prefs: KnowledgeTilePreferences): Promise<void> {
  await patchPref('tiles', { knowledge: prefs })
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
  KnowledgeTilePreferences,
  CodePreferences,
  SignboardPreferences,
  TilesPref
}

export {
  ensureTilePrefs,
  findKnowledgeTilePrefs,
  persistKnowledgeTilePrefs,
  findCodeTilePrefs,
  persistCodeTilePrefs,
  findSignboardTilePrefs,
  persistSignboardTilePrefs,
  findTilesPref
}
