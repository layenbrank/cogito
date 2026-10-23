import Fuse from 'fuse.js'
import { timeSphere } from '@cogito/utils'

import {
  matchBoothBucket,
  matchNavigateBucket,
  type BoothBucket,
  type NavigateBucket
} from '@/constants/marketplace/buckets'

const FUSE_KEYS: Array<{ name: keyof MagneticTile; weight: number }> = [
  { name: 'title', weight: 0.5 },
  { name: 'description', weight: 0.3 },
  { name: 'url', weight: 0.2 }
]

const FUSE_THRESHOLD = 0.35

const fuseByTiles = new WeakMap<MagneticTile[], Fuse<MagneticTile>>()

type VisibleCache = {
  magneticTiles: MagneticTile[]
  kind: 'booth' | 'navigate'
  bucket: string
  query: string
  tiles: MagneticTile[]
}

let visibleCache: VisibleCache | null = null

function findFuse(tiles: MagneticTile[]) {
  let fuse = fuseByTiles.get(tiles)
  if (fuse) return fuse

  fuse = new Fuse(tiles, {
    keys: FUSE_KEYS,
    threshold: FUSE_THRESHOLD,
    ignoreLocation: true
  })
  fuseByTiles.set(tiles, fuse)
  return fuse
}

/** Fuse 模糊搜索；空关键词原样返回。同一 tiles 引用复用 Fuse 实例 */
function searchTiles(tiles: MagneticTile[], query: string) {
  const trimmed = query.trim()
  if (!trimmed) return tiles

  return findFuse(tiles)
    .search(trimmed)
    .map(function (hit) {
      return hit.item
    })
}

function findCachedTiles(
  magneticTiles: MagneticTile[],
  kind: 'booth' | 'navigate',
  bucket: string,
  query: string
) {
  const cached = visibleCache
  if (
    !cached ||
    cached.magneticTiles !== magneticTiles ||
    cached.kind !== kind ||
    cached.bucket !== bucket ||
    cached.query !== query
  ) {
    return null
  }
  return cached.tiles
}

/** 磁贴列表：分类 + 搜索；同入参复用上次结果（Caption / Section 共享） */
function findBoothTiles(
  magneticTiles: MagneticTile[],
  bucket: BoothBucket,
  query: string
) {
  const trimmed = query.trim()
  const cached = findCachedTiles(magneticTiles, 'booth', bucket, trimmed)
  if (cached) return cached

  const bucketed = magneticTiles.filter(function (tile) {
    return matchBoothBucket(tile, bucket)
  })
  const tiles = searchTiles(bucketed, trimmed)
  visibleCache = {
    magneticTiles,
    kind: 'booth',
    bucket,
    query: trimmed,
    tiles
  }
  return tiles
}

/** 网址列表：分类 + 搜索；同入参复用上次结果（Caption / Section 共享） */
function findNavigateTiles(
  magneticTiles: MagneticTile[],
  bucket: NavigateBucket,
  query: string
) {
  const trimmed = query.trim()
  const cached = findCachedTiles(magneticTiles, 'navigate', bucket, trimmed)
  if (cached) return cached

  const bucketed = magneticTiles.filter(function (tile) {
    return (
      tile.component === 'navigation' &&
      Boolean(tile.url) &&
      matchNavigateBucket(tile, bucket)
    )
  })
  const tiles = searchTiles(bucketed, trimmed)
  visibleCache = {
    magneticTiles,
    kind: 'navigate',
    bucket,
    query: trimmed,
    tiles
  }
  return tiles
}

function formatUpdatedAt(updatedAt: number | null | undefined) {
  if (!updatedAt) return '暂无更新'
  return `更新于 ${timeSphere.format(new Date(updatedAt), 'YYYY-MM-DD HH:mm')}`
}

export { findBoothTiles, findNavigateTiles, formatUpdatedAt, searchTiles }
