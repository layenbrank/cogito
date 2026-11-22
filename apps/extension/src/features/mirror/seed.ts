import { database } from '@/database/database.ts'

import catalog from '@/features/mirror/wall-seed.json'

/**
 * 与客户端 `builtin_seed` / `navigation_seed` 同一份镜像：
 * 横条内置磁贴、分类集合，网址在集合里并带品牌色和 simpleicons。
 */

const WALL_SEED = 'cogito.wall.catalog'
const CATALOG_VERSION = 'client'

interface BuiltinSeed {
  id: string
  index: number
  title: string
  component: MagneticTile.Component
  background: string
  textColor: string
  size: MagneticTile.Size
  url: string | null
}

interface CollectionSeed {
  id: string
  index: number
  title: string
  background: string
  textColor: string
}

interface NavigationSeed {
  id: string
  index: number
  title: string
  url: string
  background: string
  textColor: string
  mark: string
  collectionID: string
}

const BUILTINS = catalog.builtins as BuiltinSeed[]
const COLLECTIONS = catalog.collections as CollectionSeed[]
const NAVIGATION = catalog.navigation as NavigationSeed[]

export const SEED_MIRROR: Mirror = {
  id: 'primary',
  title: '主镜像',
  index: 0,
  mark: '',
  updatedAt: 0,
  createdAt: 0,
  description: '默认镜像',
  background: null,
  backdrop: null,
  overlay: '',
  archivedAt: null
}

function paint(color: string): MagneticTile.Background {
  return { color }
}

function buildCatalog(mirrorID: string): MagneticTile[] {
  const now = Date.now()
  const tiles: MagneticTile[] = []

  for (const item of BUILTINS) {
    tiles.push({
      id: item.id,
      index: item.index,
      title: item.title,
      url: item.url,
      round: '12px',
      mark: null,
      size: item.size,
      shape: 'rectangle',
      direction: 'horizontal',
      mirrorID,
      updatedAt: now,
      createdAt: now,
      textColor: item.textColor,
      component: item.component,
      description: item.title,
      collectionID: null,
      downloadCount: 0,
      background: paint(item.background),
      backdrop: null,
      archivedAt: null
    })
  }

  for (const item of COLLECTIONS) {
    tiles.push({
      id: item.id,
      index: item.index,
      title: item.title,
      url: null,
      round: '12px',
      mark: null,
      size: 1,
      shape: 'square',
      direction: 'vertical',
      mirrorID,
      updatedAt: now,
      createdAt: now,
      textColor: item.textColor,
      component: 'collection',
      description: item.title,
      collectionID: null,
      downloadCount: 0,
      background: paint(item.background),
      backdrop: null,
      archivedAt: null
    })
  }

  for (const item of NAVIGATION) {
    tiles.push({
      id: item.id,
      index: item.index,
      title: item.title,
      url: item.url,
      round: '12px',
      mark: item.mark,
      size: 1,
      shape: 'square',
      direction: 'vertical',
      mirrorID,
      updatedAt: now,
      createdAt: now,
      textColor: item.textColor,
      component: 'navigation',
      description: item.title,
      collectionID: item.collectionID,
      downloadCount: 0,
      background: paint(item.background),
      backdrop: null,
      archivedAt: null
    })
  }

  return tiles
}

async function findCatalogVersion(): Promise<string | null> {
  const bag = await chrome.storage.local.get(WALL_SEED)
  const value = bag[WALL_SEED]
  return typeof value === 'string' ? value : null
}

async function markCatalogReady(): Promise<void> {
  await chrome.storage.local.set({ [WALL_SEED]: CATALOG_VERSION })
}

/** 库空，或还是旧的四块白磁贴时，换成客户端那份镜像。已换过的不再覆盖。 */
export async function seedIfEmpty(): Promise<void> {
  const version = await findCatalogVersion()
  const mirrors = await database.mirror.orderBy('index').toArray()
  const [existing] = mirrors

  if (!existing) {
    await database.mirror.add(SEED_MIRROR)
    await database.magneticTile.bulkAdd(buildCatalog(SEED_MIRROR.id))
    await markCatalogReady()
    return
  }

  const tiles = await database.magneticTile.where('mirrorID').equals(existing.id).toArray()
  if (version === CATALOG_VERSION) {
    if (tiles.length === 0) await database.magneticTile.bulkAdd(buildCatalog(existing.id))
    return
  }

  if (tiles.length > 0) {
    await database.magneticTile.bulkDelete(
      tiles.map(function (tile) {
        return tile.id
      })
    )
  }
  await database.magneticTile.bulkAdd(buildCatalog(existing.id))
  await markCatalogReady()
}
