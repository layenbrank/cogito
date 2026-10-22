type BookmarkViewMode = 'list' | 'grid'
type BookmarkSortKey = 'name-asc' | 'name-desc' | 'type' | 'links' | 'index'

const VIEW_KEY = 'bookmark.viewMode'
const SORT_KEY = 'bookmark.sortKey'

function readViewMode(): BookmarkViewMode {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    if (raw === 'list' || raw === 'grid') return raw
  } catch (error) {
    console.warn('[bookmark.view-prefs] readViewMode 失败', error)
  }
  return 'list'
}

function writeViewMode(mode: BookmarkViewMode) {
  try {
    localStorage.setItem(VIEW_KEY, mode)
  } catch (error) {
    console.warn('[bookmark.view-prefs] writeViewMode 失败', error)
  }
}

function readSortKey(): BookmarkSortKey {
  try {
    const raw = localStorage.getItem(SORT_KEY)
    if (
      raw === 'name-asc' ||
      raw === 'name-desc' ||
      raw === 'type' ||
      raw === 'links' ||
      raw === 'index'
    ) {
      return raw
    }
  } catch (error) {
    console.warn('[bookmark.view-prefs] readSortKey 失败', error)
  }
  return 'type'
}

function writeSortKey(key: BookmarkSortKey) {
  try {
    localStorage.setItem(SORT_KEY, key)
  } catch (error) {
    console.warn('[bookmark.view-prefs] writeSortKey 失败', error)
  }
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
