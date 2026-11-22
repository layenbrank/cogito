const STORAGE_KEY = 'cogito.bookmark.view'

type BookmarkViewMode = 'list' | 'grid'
type BookmarkSortKey = 'type' | 'name-asc' | 'name-desc' | 'links' | 'index'

interface BookmarkViewPref {
  viewMode: BookmarkViewMode
  sortKey: BookmarkSortKey
}

const FALLBACK: BookmarkViewPref = {
  viewMode: 'list',
  sortKey: 'type'
}

const SORT_OPTIONS: Array<{ value: BookmarkSortKey; label: string }> = [
  { value: 'type', label: '类型（文件夹优先）' },
  { value: 'name-asc', label: '名称 A→Z' },
  { value: 'name-desc', label: '名称 Z→A' },
  { value: 'links', label: '链接数量' },
  { value: 'index', label: '导入顺序' }
]

function readPref(): BookmarkViewPref {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return FALLBACK
    const parsed = JSON.parse(raw) as Partial<BookmarkViewPref>
    const viewMode = parsed.viewMode === 'grid' || parsed.viewMode === 'list' ? parsed.viewMode : FALLBACK.viewMode
    const sortKey = SORT_OPTIONS.some(function (option) {
      return option.value === parsed.sortKey
    })
      ? (parsed.sortKey as BookmarkSortKey)
      : FALLBACK.sortKey
    return { viewMode, sortKey }
  } catch (error) {
    console.warn('[bookmark] 读取视图偏好失败', error)
    return FALLBACK
  }
}

function writePref(patch: Partial<BookmarkViewPref>): void {
  const next = { ...readPref(), ...patch }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function readViewMode(): BookmarkViewMode {
  return readPref().viewMode
}

function writeViewMode(mode: BookmarkViewMode): void {
  writePref({ viewMode: mode })
}

function readSortKey(): BookmarkSortKey {
  return readPref().sortKey
}

function writeSortKey(key: BookmarkSortKey): void {
  writePref({ sortKey: key })
}

export { SORT_OPTIONS, readSortKey, readViewMode, writeSortKey, writeViewMode }
export type { BookmarkSortKey, BookmarkViewMode }
