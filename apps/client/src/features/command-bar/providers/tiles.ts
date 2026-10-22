/**
 * 磁贴 / 集合 / 网址 provider
 */
import Fuse from 'fuse.js'

import { OMNIBAR_UI } from '@/features/command-bar/constants'
import { activateTile } from '@/features/magnetic-tile/activate'
import type { Hit, SearchProvider } from '@/features/command-bar/types'
import { uniqueBy } from '@/features/command-bar/unique'
import { useMirrorStore } from '@/stores/mirror'

const FUSE_KEYS: Array<{ name: keyof MagneticTile; weight: number }> = [
  { name: 'title', weight: 0.5 },
  { name: 'description', weight: 0.3 },
  { name: 'url', weight: 0.2 }
]

const fuseByTiles = new WeakMap<MagneticTile[], Fuse<MagneticTile>>()

/** component → Hit.domain */
const COMPONENT_DOMAIN: Partial<Record<MagneticTile.Component, Hit['domain']>> = {
  collection: 'collection',
  navigation: 'navigation'
}

const COMPONENT_ICON: Partial<Record<MagneticTile.Component, string>> = {
  collection: 'lucide:folder',
  navigation: 'lucide:globe'
}

function findFuse(tiles: MagneticTile[]) {
  let fuse = fuseByTiles.get(tiles)
  if (fuse) return fuse
  fuse = new Fuse(tiles, {
    keys: FUSE_KEYS,
    threshold: 0.35,
    ignoreLocation: true,
    includeScore: true
  })
  fuseByTiles.set(tiles, fuse)
  return fuse
}

function findDomain(component: MagneticTile.Component): Hit['domain'] {
  return COMPONENT_DOMAIN[component] ?? 'tile'
}

function findIcon(component: MagneticTile.Component): string {
  return COMPONENT_ICON[component] ?? 'lucide:layout-grid'
}

function toHit(tile: MagneticTile, score: number): Hit {
  const domain = findDomain(tile.component)
  return {
    domain,
    id: tile.id,
    title: tile.title || tile.component,
    subtitle: tile.url || tile.description || tile.component,
    score,
    icon: findIcon(tile.component),
    async run() {
      await activateTile(tile)
    }
  }
}

/**
 * 空查询：navigation 可多条；其它 component 每种一条。
 * 展示层还有 face 去重；这里先压缩源数据，避免 LOCAL_LIMIT 被同类占满。
 */
function findEmptyQueryTiles(tiles: MagneticTile[]): MagneticTile[] {
  const seenComponent = new Set<string>()
  const next: MagneticTile[] = []
  for (const tile of tiles) {
    if (tile.component === 'navigation') {
      next.push(tile)
    } else if (!seenComponent.has(tile.component)) {
      seenComponent.add(tile.component)
      next.push(tile)
    }
    if (next.length >= OMNIBAR_UI.LOCAL_LIMIT) break
  }
  return next
}

function searchTiles(query: string): Hit[] {
  const tiles = uniqueBy(useMirrorStore.getState().magneticTiles, function (tile) {
    return tile.id
  })
  if (!tiles.length) return []

  if (!query.trim()) {
    return findEmptyQueryTiles(tiles).map(function (tile) {
      return toHit(tile, 0.5)
    })
  }

  return findFuse(tiles)
    .search(query)
    .slice(0, OMNIBAR_UI.LOCAL_LIMIT)
    .map(function (row) {
      const score = row.score === null || row.score === undefined ? 1 : 1 - row.score
      return toHit(row.item, score)
    })
}

function filterDomain(
  domain: Hit['domain']
): SearchProvider {
  return {
    domain,
    search(query) {
      return searchTiles(query).filter(function (hit) {
        return hit.domain === domain
      })
    }
  }
}

const tilesProvider = filterDomain('tile')
const collectionProvider = filterDomain('collection')
const navigationProvider = filterDomain('navigation')

export { tilesProvider, collectionProvider, navigationProvider }
