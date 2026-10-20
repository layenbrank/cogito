import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import type { BookmarkNode } from '@/views/bookmark/import/types'

/** 从 bookmark 表重建前端树 */
async function fetchBookmarkTree(mirrorID: string): Promise<BookmarkNode[]> {
  const rows = await invoke<Bookmark.Entry[]>(CHANNELS.BOOKMARK.READ, {
    params: { mirrorID }
  })
  return buildTreeFromRows(rows)
}

function buildTreeFromRows(rows: Bookmark.Entry[]): BookmarkNode[] {
  const byParent = new Map<string | null, Bookmark.Entry[]>()
  for (const row of rows) {
    const key = row.parentID
    const list = byParent.get(key) ?? []
    list.push(row)
    byParent.set(key, list)
  }

  function childrenOf(parentID: string | null): BookmarkNode[] {
    const list = (byParent.get(parentID) ?? []).toSorted(function (a, b) {
      if (a.index !== b.index) return a.index - b.index
      return a.title.localeCompare(b.title, 'zh')
    })
    return list.map(function (row) {
      if (row.url) {
        return {
          id: row.id,
          title: row.title,
          url: row.url,
          index: row.index,
          updatedAt: row.updatedAt
        }
      }
      return {
        id: row.id,
        title: row.title,
        index: row.index,
        updatedAt: row.updatedAt,
        children: childrenOf(row.id)
      }
    })
  }

  return childrenOf(null)
}

export { buildTreeFromRows, fetchBookmarkTree }
