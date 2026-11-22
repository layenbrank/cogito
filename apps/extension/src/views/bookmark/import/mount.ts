/**
 * 将已入库书签可选挂到磁贴：navigation 或 collection。
 */
import { database } from '@/database/database.ts'
import { findSiteMark } from '@/features/magnetic-tile/mark.ts'

type MountAs = 'navigation' | 'collection'

type MountOptions = {
  mirrorID: string
  nodeIds: string[]
  as: MountAs
}

interface TileWrite {
  title: string
  url: string | null
  mark: string | null
  component: 'navigation' | 'collection'
  collectionID: string | null
}

function buildNavigationWrite(
  title: string,
  url: string,
  collectionID: string | null
): TileWrite {
  return {
    title,
    url,
    mark: findSiteMark(url),
    component: 'navigation',
    collectionID
  }
}

function buildCollectionWrite(title: string, collectionID: string | null): TileWrite {
  return {
    title,
    url: null,
    mark: null,
    component: 'collection',
    collectionID
  }
}

async function insertWrites(mirrorID: string, writes: TileWrite[]): Promise<string[]> {
  if (!writes.length) return []
  return database.transaction('rw', database.magneticTile, async function () {
    const tiles = await database.magneticTile.where('mirrorID').equals(mirrorID).toArray()
    let index = tiles.reduce(function (max, tile) {
      return Math.max(max, tile.index)
    }, -1)
    const now = Date.now()
    const ids: string[] = []
    for (const write of writes) {
      index += 1
      const id = crypto.randomUUID()
      ids.push(id)
      await database.magneticTile.add({
        id,
        index,
        title: write.title,
        url: write.url,
        round: '12px',
        mark: write.mark,
        size: 1,
        shape: 'square',
        direction: 'vertical',
        mirrorID,
        updatedAt: now,
        createdAt: now,
        textColor: '0F172A',
        component: write.component,
        description: write.title,
        collectionID: write.collectionID,
        downloadCount: 0,
        background: { color: write.component === 'collection' ? '#FFFFFF' : '#F8FAFC' },
        backdrop: null,
        archivedAt: null
      })
    }
    return ids
  })
}

async function findBookmarkSubtree(mirrorID: string, rootId: string) {
  const all = await database.bookmark.where('mirrorID').equals(mirrorID).toArray()
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
 * 把书签节点挂到镜像：
 * - navigation：仅链接 → 网址磁贴
 * - collection：文件夹 → 集合，内部链接挂 collectionID；子文件夹嵌套集合
 */
async function mountBookmarksToTiles(options: MountOptions): Promise<{ mounted: number }> {
  if (!options.nodeIds.length) {
    throw new Error('请先选择书签或文件夹')
  }

  let mounted = 0
  const existing = await database.magneticTile.where('mirrorID').equals(options.mirrorID).toArray()
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
    const pending: { title: string; url: string }[] = []
    for (const id of options.nodeIds) {
      const rows = await findBookmarkSubtree(options.mirrorID, id)
      for (const row of rows) {
        if (!row.url) continue
        if (urlSet.has(row.url)) continue
        pending.push({ title: row.title, url: row.url })
        urlSet.add(row.url)
        mounted += 1
      }
    }
    await insertWrites(
      options.mirrorID,
      pending.map(function (item) {
        return buildNavigationWrite(item.title, item.url, null)
      })
    )
    return { mounted }
  }

  for (const id of options.nodeIds) {
    const rows = await findBookmarkSubtree(options.mirrorID, id)
    const root = rows[0]
    if (!root) continue

    const idMap = new Map<string, string>()

    async function ensureCollection(
      bookmarkId: string,
      title: string,
      parentCollectionID: string | null
    ) {
      const existingId = idMap.get(bookmarkId)
      if (existingId) return existingId
      const [createdId] = await insertWrites(options.mirrorID, [
        buildCollectionWrite(title, parentCollectionID)
      ])
      if (!createdId) throw new Error(`集合「${title}」创建失败`)
      mounted += 1
      idMap.set(bookmarkId, createdId)
      return createdId
    }

    if (root.url) {
      if (!urlSet.has(root.url)) {
        await insertWrites(options.mirrorID, [buildNavigationWrite(root.title, root.url, null)])
        urlSet.add(root.url)
        mounted += 1
      }
      continue
    }

    const rootCollectionId = await ensureCollection(root.id, root.title, null)
    const pendingNav: { title: string; url: string; collectionID: string }[] = []

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
        collectionID: parentCollectionID
      })
      urlSet.add(row.url)
      mounted += 1
    }

    await insertWrites(
      options.mirrorID,
      pendingNav.map(function (item) {
        return buildNavigationWrite(item.title, item.url, item.collectionID)
      })
    )
  }

  return { mounted }
}

export { mountBookmarksToTiles }
export type { MountAs }
