import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'

const PREVIEW_COUNT = 4

const cache = new Map<string, string[]>()
const inflight = new Map<string, Promise<string[]>>()
/** 每个集合当前生效的 revision；写入前校验，淘汰同 id 旧 key */
const revisions = new Map<string, number>()

function findInitial(title: string) {
  return [...title].at(0) ?? '?'
}

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

async function fetchCollectionPreviews(collectionId: string): Promise<string[]> {
  const members = await invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
    params: { collectionID: collectionId }
  })
  return members
    .toSorted(function (a, b) {
      return a.index - b.index
    })
    .slice(0, PREVIEW_COUNT)
    .map(function (tile) {
      return tile.mark || findInitial(tile.title)
    })
}

/**
 * 集合 marker 预览字；按 id+revision 缓存。
 * Activity 再 visible 且 revision 未变时命中缓存，不重复 IPC。
 */
function fetchCollectionMarkerPreviews(
  collectionId: string,
  revision: number
): Promise<string[]> {
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
    .catch(function () {
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
