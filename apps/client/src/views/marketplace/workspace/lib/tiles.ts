import Fuse from 'fuse.js'
import { timeSphere } from '@cogito/utils'

import {
  findBoothBucket,
  findNavigateBucket,
  matchBoothBucket,
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

type BoothBucketKey = Exclude<BoothBucket, 'all'>
type NavigateBucketKey = Exclude<NavigateBucket, 'all'>

type BoothGroups = {
  all: MagneticTile[]
  byBucket: Record<BoothBucketKey, MagneticTile[]>
}

type NavigateGroups = {
  all: MagneticTile[]
  byBucket: Record<NavigateBucketKey, MagneticTile[]>
}

type VisibleCache = {
  magneticTiles: MagneticTile[]
  kind: 'booth' | 'navigate'
  bucket: string
  query: string
  tiles: MagneticTile[]
}

const boothGroupsByTiles = new WeakMap<MagneticTile[], BoothGroups>()
const navigateGroupsByTiles = new WeakMap<MagneticTile[], NavigateGroups>()

let visibleCache: VisibleCache | null = null

function emptyBoothByBucket(): Record<BoothBucketKey, MagneticTile[]> {
  return {
    schedule: [],
    notes: [],
    media: [],
    dev: [],
    apps: [],
    system: []
  }
}

function emptyNavigateByBucket(): Record<NavigateBucketKey, MagneticTile[]> {
  return {
    search: [],
    shopping: [],
    social: [],
    video: [],
    music: [],
    news: [],
    life: [],
    dev: [],
    office: [],
    ai: [],
    learn: [],
    design: []
  }
}

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

/** 按 component 分桶一次；同一 magneticTiles 引用复用 */
function findBoothGroups(magneticTiles: MagneticTile[]) {
  const cached = boothGroupsByTiles.get(magneticTiles)
  if (cached) return cached

  const all: MagneticTile[] = []
  const byBucket = emptyBoothByBucket()

  for (const tile of magneticTiles) {
    if (!matchBoothBucket(tile, 'all')) continue
    all.push(tile)
    byBucket[findBoothBucket(tile.component)].push(tile)
  }

  const groups: BoothGroups = { all, byBucket }
  boothGroupsByTiles.set(magneticTiles, groups)
  return groups
}

/** 按导航标题分桶一次；同一 magneticTiles 引用复用 */
function findNavigateGroups(magneticTiles: MagneticTile[]) {
  const cached = navigateGroupsByTiles.get(magneticTiles)
  if (cached) return cached

  const all: MagneticTile[] = []
  const byBucket = emptyNavigateByBucket()

  for (const tile of magneticTiles) {
    if (tile.component !== 'navigation' || !tile.url) continue
    all.push(tile)
    byBucket[findNavigateBucket(tile)].push(tile)
  }

  const groups: NavigateGroups = { all, byBucket }
  navigateGroupsByTiles.set(magneticTiles, groups)
  return groups
}

function findBoothBucketTiles(magneticTiles: MagneticTile[], bucket: BoothBucket) {
  const groups = findBoothGroups(magneticTiles)
  if (bucket === 'all') return groups.all
  return groups.byBucket[bucket]
}

function findNavigateBucketTiles(
  magneticTiles: MagneticTile[],
  bucket: NavigateBucket
) {
  const groups = findNavigateGroups(magneticTiles)
  if (bucket === 'all') return groups.all
  return groups.byBucket[bucket]
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

  const bucketed = findBoothBucketTiles(magneticTiles, bucket)
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

  const bucketed = findNavigateBucketTiles(magneticTiles, bucket)
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
