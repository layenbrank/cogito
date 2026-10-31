import type { BookmarkSortKey } from '@/views/bookmark/view-prefs'

type ExplorerRow =
  | { kind: 'folder'; path: string; id: string; title: string; count: number; index: number }
  | { kind: 'link'; path: string; id: string; title: string; url: string; index: number }

function compareExplorerRows(a: ExplorerRow, b: ExplorerRow, sortKey: BookmarkSortKey) {
  if (sortKey === 'type') {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, 'zh')
  }
  if (sortKey === 'name-asc') return a.title.localeCompare(b.title, 'zh')
  if (sortKey === 'name-desc') return b.title.localeCompare(a.title, 'zh')
  if (sortKey === 'links') {
    const ac = a.kind === 'folder' ? a.count : 0
    const bc = b.kind === 'folder' ? b.count : 0
    if (ac !== bc) return bc - ac
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.title.localeCompare(b.title, 'zh')
  }
  if (a.index !== b.index) return a.index - b.index
  return a.title.localeCompare(b.title, 'zh')
}

export type { ExplorerRow }
export { compareExplorerRows }
