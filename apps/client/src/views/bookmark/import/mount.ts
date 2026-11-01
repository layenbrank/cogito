/**
 * 将已入库书签可选挂到磁贴：navigation 或 collection。
 */
import { invoke } from '@tauri-apps/api/core'

import { findFaviconFallback } from '@/features/magnetic-tile/mark.ts'
import { fetchSiteFavicon } from '@/lib/site-favicon.ts'
import { CHANNELS } from '@/shared/ipc/channels'
import type { MagneticTileWrite } from '@/stores/mirror'
import { findNextIndex } from '@/views/marketplace/workspace/lib/insert-tile'

type MountAs = 'navigation' | 'collection'

function buildNavigationWrite(
  title: string,
  url: string,
  mirrorID: string,
  index: number,
  collectionID: string | null,
  mark: string | null
): MagneticTileWrite {
  return {
    index,
    title,
    url,
    round: '12px',
    mark,
    component: 'navigation',
    description: title,
    background: { color: '#F8FAFC' },
    backdrop: null,
    mirrorID,
    textColor: '0F172A',
    collectionID,
    size: 1,
    shape: 'square',
    direction: 'vertical'
  }
}

async function resolveNavigationMark(url: string) {
  try {
    const favicon = await fetchSiteFavicon(url)
    if (favicon) return favicon
  } catch (error) {
    console.warn('[bookmark-import] favicon 解析失败，回退 DDG:', error)
  }
  return findFaviconFallback(url)
}

function buildCollectionWrite(
  title: string,
  mirrorID: string,
  index: number,
  parentCollectionID: string | null
): MagneticTileWrite {
  return {
    index,
    title,
    url: null,
    round: '12px',
    mark: null,
    component: 'collection',
    description: title,
    background: { color: '#FFFFFF' },
    backdrop: null,
    mirrorID,
    textColor: '0F172A',
    collectionID: parentCollectionID,
    size: 1,
    shape: 'square',
    direction: 'vertical'
  }
}

async function findMirrorTiles(mirrorID: string) {
  return invoke<MagneticTile[]>(CHANNELS.MAGNETIC_TILE.READ, {
    params: { mirrorID }
  })
}

async function findBookmarkSubtree(mirrorID: string, rootId: string) {
  const all = await invoke<Bookmark.Entry[]>(CHANNELS.BOOKMARK.READ, {
    params: { mirrorID }
  })
  const byParent = new Map<string | null, Bookmark.Entry[]>()
  for (const row of all) {
    const key = row.parentID
    const list = byParent.get(key) ?? []
    list.push(row)
    byParent.set(key, list)
  }

  const root = all.find(function (row) {
    return row.id === rootId
  })
  if (!root) return [] as Bookmark.Entry[]

  const out: Bookmark.Entry[] = []
  function walk(id: string) {
    const children = byParent.get(id) ?? []
    for (const child of children) {
      out.push(child)
      if (!child.url) walk(child.id)
    }
  }
  out.push(root)
  if (!root.url) walk(root.id)
  return out
}

/**
 * 把书签节点挂到磁贴墙：
 * - navigation：仅链接 → 网址磁贴
 * - collection：文件夹 → 集合，内部链接挂 collectionID；子文件夹嵌套集合
 */
async function mountBookmarksToTiles(options: {
  mirrorID: string
  nodeIds: string[]
  as: MountAs
}): Promise<{ mounted: number }> {
  if (!options.nodeIds.length) {
    throw new Error('请先选择书签或文件夹')
  }

  let nextIndex = await findNextIndex(options.mirrorID)
  let mounted = 0
  const existing = await findMirrorTiles(options.mirrorID)
  const urlSet = new Set(
    existing
      .filter(function (tile) {
        return tile.component === 'navigation' && tile.url
      })
      .map(function (tile) {
        return tile.url as string
      })
  )

  if (options.as === 'navigation') {
    const pending: { title: string; url: string; index: number }[] = []
    const subtrees = await Promise.allSettled(
      options.nodeIds.map(function (id) {
        return findBookmarkSubtree(options.mirrorID, id)
      })
    )
    for (const result of subtrees) {
      if (result.status === 'rejected') {
        console.warn('[bookmark-import] 读取书签子树失败', result.reason)
        continue
      }
      const rows = result.value
      for (const row of rows) {
        if (!row.url) continue
        if (urlSet.has(row.url)) continue
        pending.push({ title: row.title, url: row.url, index: nextIndex })
        nextIndex += 1
        urlSet.add(row.url)
        mounted += 1
      }
    }
    const marks = await Promise.allSettled(
      pending.map(function (item) {
        return resolveNavigationMark(item.url)
      })
    )
    const writes: MagneticTileWrite[] = pending.map(function (item, i) {
      const markResult = marks[i]
      const mark =
        markResult.status === 'fulfilled'
          ? markResult.value
          : findFaviconFallback(item.url)
      if (markResult.status === 'rejected') {
        console.warn('[bookmark-import] favicon 失败:', markResult.reason)
      }
      return buildNavigationWrite(
        item.title,
        item.url,
        options.mirrorID,
        item.index,
        null,
        mark
      )
    })
    if (writes.length) {
      const params = writes.length === 1 ? writes[0] : writes
      await invoke(CHANNELS.MAGNETIC_TILE.WRITE, { params })
    }
    return { mounted }
  }

  // collection：nextIndex / idMap 跨节点共享，须按 nodeIds 顺序挂载
  for (const id of options.nodeIds) {
    const rows = await findBookmarkSubtree(options.mirrorID, id)
    const root = rows[0]
    if (!root) continue

    const idMap = new Map<string, string>() // bookmarkId → collection tile id

    async function ensureCollection(
      bookmarkId: string,
      title: string,
      parentCollectionID: string | null
    ) {
      const existingId = idMap.get(bookmarkId)
      if (existingId) return existingId
      await invoke(CHANNELS.MAGNETIC_TILE.WRITE, {
        params: buildCollectionWrite(title, options.mirrorID, nextIndex, parentCollectionID)
      })
      nextIndex += 1
      mounted += 1
      const tiles = await findMirrorTiles(options.mirrorID)
      const created = tiles
        .filter(function (tile) {
          return (
            tile.component === 'collection' &&
            tile.title === title &&
            (tile.collectionID ?? null) === parentCollectionID
          )
        })
        .toSorted(function (a, b) {
          return b.createdAt - a.createdAt
        })[0]
      if (!created) throw new Error(`集合「${title}」创建失败`)
      idMap.set(bookmarkId, created.id)
      return created.id
    }

    if (root.url) {
      if (!urlSet.has(root.url)) {
        const mark = await resolveNavigationMark(root.url)
        await invoke(CHANNELS.MAGNETIC_TILE.WRITE, {
          params: buildNavigationWrite(
            root.title,
            root.url,
            options.mirrorID,
            nextIndex,
            null,
            mark
          )
        })
        nextIndex += 1
        mounted += 1
      }
      continue
    }

    const rootCollectionId = await ensureCollection(root.id, root.title, null)
    const pendingNav: {
      title: string
      url: string
      index: number
      collectionID: string
    }[] = []

    // 子文件夹须等父集合写入 idMap 后再建，保持树序
    for (const row of rows.slice(1)) {
      if (!row.url) {
        const parentBookmark = rows.find(function (item) {
          return item.id === row.parentID
        })
        const parentCollectionID = parentBookmark
          ? (idMap.get(parentBookmark.id) ?? rootCollectionId)
          : rootCollectionId
        await ensureCollection(row.id, row.title, parentCollectionID)
        continue
      }
      if (urlSet.has(row.url)) continue
      const parentCollectionID = row.parentID
        ? (idMap.get(row.parentID) ?? rootCollectionId)
        : rootCollectionId
      pendingNav.push({
        title: row.title,
        url: row.url,
        index: nextIndex,
        collectionID: parentCollectionID
      })
      nextIndex += 1
      urlSet.add(row.url)
      mounted += 1
    }

    const marks = await Promise.allSettled(
      pendingNav.map(function (item) {
        return resolveNavigationMark(item.url)
      })
    )
    const navWrites: MagneticTileWrite[] = pendingNav.map(function (item, i) {
      const markResult = marks[i]
      const mark =
        markResult.status === 'fulfilled'
          ? markResult.value
          : findFaviconFallback(item.url)
      if (markResult.status === 'rejected') {
        console.warn('[bookmark-import] favicon 失败:', markResult.reason)
      }
      return buildNavigationWrite(
        item.title,
        item.url,
        options.mirrorID,
        item.index,
        item.collectionID,
        mark
      )
    })

    if (navWrites.length) {
      const params = navWrites.length === 1 ? navWrites[0] : navWrites
      await invoke(CHANNELS.MAGNETIC_TILE.WRITE, { params })
    }
  }

  return { mounted }
}

export { mountBookmarksToTiles }
export type { MountAs }
