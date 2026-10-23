import { findPref, patchPref } from '@/features/persist'
import type { BookmarkSortKey, BookmarkViewMode } from '@/features/persist'

function readViewMode(): BookmarkViewMode {
  return findPref('tiles').bookmark.viewMode
}

function writeViewMode(mode: BookmarkViewMode) {
  void patchPref('tiles', {
    bookmark: { ...findPref('tiles').bookmark, viewMode: mode }
  })
}

function readSortKey(): BookmarkSortKey {
  return findPref('tiles').bookmark.sortKey
}

function writeSortKey(key: BookmarkSortKey) {
  void patchPref('tiles', {
    bookmark: { ...findPref('tiles').bookmark, sortKey: key }
  })
}

const SORT_OPTIONS: Array<{ value: BookmarkSortKey; label: string }> = [
  { value: 'type', label: '类型（文件夹优先）' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'links', label: '链接数量' },
  { value: 'index', label: '导入顺序' }
]

export {
  SORT_OPTIONS,
  readSortKey,
  readViewMode,
  writeSortKey,
  writeViewMode
}
export type { BookmarkSortKey, BookmarkViewMode }
