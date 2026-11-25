/**
 * 将已入库书签可选挂到磁贴：navigation 或 collection。
 */
import { GET_BOOKMARKS } from '@/apis/bookmark'
import { GET_MAGNETIC_TILES, POST_MAGNETIC_TILES } from '@/apis/magnetic-tile'
import { findFaviconFallback } from '@/features/magnetic-tile/mark.ts'
import { GET_SITE_FAVICON } from '@/apis/site-favicon'
import { useMirrorStore, type MagneticTileWrite } from '@/stores/mirror'

type MountAs = 'navigation' | 'collection'

type MountOptions = {
  mirrorID: string
  nodeIds: string[]
  as: MountAs
}

/** 批量写入：一条 / 多条走同一个命令，返回后端主键（顺序与入参一致） */
async function insertWrites(writes: MagneticTileWrite[]): Promise<string[]> {
  if (!writes.length) return []
  const params = writes.length === 1 ? writes[0] : writes
  return POST_MAGNETIC_TILES<string[]>(params)
}

/** 写完整批后刷一次墙；只在导入的正是当前墙时才刷，别把别的镜像顶到界面上 */
async function refreshActiveMirror(mirrorID: string): Promise<void> {
  const store = useMirrorStore.getState()
  if (store.active.mirror?.id !== mirrorID) return
  await store.toReadMirror(mirrorID)
}

function buildNavigationWrite(
  title: string,
  url: string,
  mirrorID: string,
  collectionID: string | null,
  mark: string | null
): MagneticTileWrite {
  return {
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
    const favicon = await GET_SITE_FAVICON(url)
    if (favicon) return favicon
  } catch (error) {
    console.warn('[bookmark-import] favicon 解析失败，回退 DDG:', error)
  }
  return findFaviconFallback(url)
}

function buildCollectionWrite(
  title: string,
  mirrorID: string,
  parentCollectionID: string | null
): MagneticTileWrite {
  return {
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
  return GET_MAGNETIC_TILES<MagneticTile[]>({ mirrorID })
}

async function findBookmarkSubtree(mirrorID: string, rootId: string) {
  const all = await GET_BOOKMARKS<Bookmark.Entry[]>({ mirrorID })
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
 *
 * index 由后端在同一事务里递增分配（`MAX(index) + 1, +2 …`），
 * 所以整批写入天然保持入参顺序，前端不用再维护号段、也不用排队防撞号。
 */
async function mountBookmarksToTiles(options: MountOptions): Promise<{ mounted: number }> {
  if (!options.nodeIds.length) {
    throw new Error('请先选择书签或文件夹')
  }

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
    const pending: { title: string; url: string }[] = []
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
        pending.push({ title: row.title, url: row.url })
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
        null,
        mark
      )
    })
    await insertWrites(writes)
    await refreshActiveMirror(options.mirrorID)
    return { mounted }
  }

  // collection：idMap 跨节点共享，须按 nodeIds 顺序挂载
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
      const [createdId] = await insertWrites([
        buildCollectionWrite(title, options.mirrorID, parentCollectionID)
      ])
      if (!createdId) throw new Error(`集合「${title}」创建失败`)
      mounted += 1
      idMap.set(bookmarkId, createdId)
      return createdId
    }

    if (root.url) {
      if (!urlSet.has(root.url)) {
        const mark = await resolveNavigationMark(root.url)
        await insertWrites([
          buildNavigationWrite(
            root.title,
            root.url,
            options.mirrorID,
            null,
            mark
          )
        ])
        mounted += 1
      }
      continue
    }

    const rootCollectionId = await ensureCollection(root.id, root.title, null)
    const pendingNav: {
      title: string
      url: string
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
        collectionID: parentCollectionID
      })
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
        item.collectionID,
        mark
      )
    })

    await insertWrites(navWrites)
  }

  await refreshActiveMirror(options.mirrorID)
  return { mounted }
}

export { mountBookmarksToTiles }
export type { MountAs }
