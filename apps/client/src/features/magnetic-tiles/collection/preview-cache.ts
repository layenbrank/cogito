import { invoke } from '@tauri-apps/api/core'

import {
  findNavigationIconSrc,
  findNavigationLabel
} from '@/features/magnetic-tile/mark.ts'
import { CHANNELS } from '@/shared/ipc/channels'

const PREVIEW_COUNT = 4

interface CollectionPreview {
  /** 成员 mark / 兜底 favicon；无图时用 label */
  src: string | null
  label: string
  /** 成员磁贴背景色，预览格要带上，否则白标会糊在白底上 */
  surface: string | null
  /** 字形兜底时的油墨色 */
  ink: string | null
}

const cache = new Map<string, CollectionPreview[]>()
const inflight = new Map<string, Promise<CollectionPreview[]>>()
/** 每个集合当前生效的 revision；写入前校验，淘汰同 id 旧 key */
const revisions = new Map<string, number>()

function findCacheKey(collectionId: string, revision: number) {
  return `${collectionId}:${revision}`
}

function evictStaleCollectionKeys(collectionId: string, revision: number) {
  const prefix = `${collectionId}:`
  for (const key of cache.keys()) {
    if (!key.startsWith(prefix)) continue
    if (key === findCacheKey(collectionId, revision)) continue
    cache.delete(key)
  }
  for (const key of inflight.keys()) {
    if (!key.startsWith(prefix)) continue
    if (key === findCacheKey(collectionId, revision)) continue
    inflight.delete(key)
  }
}

function readCollectionMarkerPreviews(collectionId: string, revision: number) {
  return cache.get(findCacheKey(collectionId, revision))
}

function parseInk(textColor: string | null | undefined) {
  if (!textColor) return null
  const trimmed = textColor.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('#') || trimmed.startsWith('rgb') || trimmed.startsWith('hsl')) {
    return trimmed
  }
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed}`
  }
  return trimmed
}

function parseMemberPreview(tile: MagneticTile): CollectionPreview {
  return {
    src: findNavigationIconSrc(tile.mark, tile.url),
    label: findNavigationLabel(tile.mark, tile.title),
    surface: tile.background?.color ?? null,
    ink: parseInk(tile.textColor)
  }
}

async function fetchCollectionPreviews(
  collectionId: string
): Promise<CollectionPreview[]> {
  const members = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
    params: { collectionID: collectionId }
  })
  return members
    .toSorted(function (a, b) {
      return a.index - b.index
    })
    .slice(0, PREVIEW_COUNT)
    .map(parseMemberPreview)
}

/**
 * 集合 marker 预览（成员真实图标）；按 id+revision 缓存。
 */
function fetchCollectionMarkerPreviews(
  collectionId: string,
  revision: number
): Promise<CollectionPreview[]> {
  revisions.set(collectionId, revision)
  evictStaleCollectionKeys(collectionId, revision)

  const key = findCacheKey(collectionId, revision)
  const hit = cache.get(key)
  if (hit !== undefined) return Promise.resolve(hit)
  const pending = inflight.get(key)
  if (pending) return pending

  const request = fetchCollectionPreviews(collectionId)
    .then(function (previews) {
      if (revisions.get(collectionId) !== revision) return previews
      cache.set(key, previews)
      return previews
    })
    .catch(function (error) {
      console.error('[collection] 预览加载失败:', error)
      if (revisions.get(collectionId) !== revision) return []
      cache.set(key, [])
      return []
    })
    .finally(function () {
      if (revisions.get(collectionId) === revision) inflight.delete(key)
    })
  inflight.set(key, request)
  return request
}

function invalidateCollectionMarkerPreviews(collectionId?: string) {
  if (!collectionId) {
    cache.clear()
    inflight.clear()
    revisions.clear()
    return
  }
  revisions.delete(collectionId)
  const prefix = `${collectionId}:`
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key)
  }
}

export {
  fetchCollectionMarkerPreviews,
  invalidateCollectionMarkerPreviews,
  readCollectionMarkerPreviews
}
export type { CollectionPreview }
