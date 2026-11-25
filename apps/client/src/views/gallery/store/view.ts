import { create } from 'zustand'

import { findPref, patchPref } from '@/features/persist'
import type { GalleryPref } from '@/features/persist/types'
import type { GallerySortKey, SectionScope } from '@/views/gallery/model/derive'
import { createFilter, parseFilter, serializeFilter, type GalleryFilterState } from '@/views/gallery/model/filter'
import type { GalleryViewID } from '@/views/gallery/model/views'

/**
 * 视图状态：当前视图 / 排序 / 分组粒度 / 密度 / 折叠 / 侧栏与检查器开关 / 筛选。
 *
 * 全部落到 `GalleryPref`（Tauri Store）。旧实现这些状态都散在 `gallery.tsx` 的
 * 十几个 `useState` 里，切走再回来全部重置 —— 这里一次性修掉。
 */
interface ViewState {
  viewID: GalleryViewID
  sortKey: GallerySortKey
  sectionScope: SectionScope
  columnCount: number
  isStackFolded: boolean
  isSidebarOpen: boolean
  isInspectorOpen: boolean
  filter: GalleryFilterState
  /** 局部文字筛选（文件名 / 拼音 / 关键词） */
  query: string
  activeAlbumID: string | null
  activeSmartAlbumID: string | null
  toSetView: (viewID: GalleryViewID) => void
  toSetSort: (sortKey: GallerySortKey) => void
  toSetSection: (scope: SectionScope) => void
  toSetColumns: (count: number) => void
  toToggleStacks: () => void
  toToggleSidebar: () => void
  toToggleInspector: () => void
  toPatchFilter: (patch: Partial<GalleryFilterState>) => void
  toResetFilter: () => void
  toSetQuery: (query: string) => void
  toSetAlbum: (albumID: string | null) => void
  toSetSmartAlbum: (smartAlbumID: string | null) => void
}

const MIN_COLUMNS = 2
const MAX_COLUMNS = 8

function readStoredPref(): GalleryPref | null {
  try {
    return findPref('gallery')
  } catch (error) {
    console.warn('[gallery] 读取视图偏好失败，使用默认值', error)
    return null
  }
}

function persist(state: ViewState): void {
  void patchPref('gallery', {
    viewID: state.viewID,
    sortKey: state.sortKey,
    sectionScope: state.sectionScope,
    columnCount: state.columnCount,
    isStackFolded: state.isStackFolded,
    isSidebarOpen: state.isSidebarOpen,
    isInspectorOpen: state.isInspectorOpen,
    filter: serializeFilter(state.filter)
  })
}

const stored = readStoredPref()

const useViewStore = create<ViewState>()(function (set, get) {
  function commit(patch: Partial<ViewState>): void {
    set(patch)
    persist(get())
  }

  return {
    viewID: (stored?.viewID as GalleryViewID) ?? 'all',
    sortKey: (stored?.sortKey as GallerySortKey) ?? 'capturedAt',
    sectionScope: (stored?.sectionScope as SectionScope) ?? 'day',
    columnCount: Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, stored?.columnCount ?? 5)),
    isStackFolded: stored?.isStackFolded ?? true,
    isSidebarOpen: stored?.isSidebarOpen ?? true,
    isInspectorOpen: stored?.isInspectorOpen ?? false,
    filter: stored?.filter ? parseFilter(stored.filter) ?? createFilter() : createFilter(),
    query: '',
    activeAlbumID: null,
    activeSmartAlbumID: null,

    toSetView(viewID) {
      commit({ viewID, activeAlbumID: null, activeSmartAlbumID: null })
    },
    toSetSort(sortKey) {
      commit({ sortKey })
    },
    toSetSection(scope) {
      commit({ sectionScope: scope })
    },
    toSetColumns(count) {
      commit({ columnCount: Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, count)) })
    },
    toToggleStacks() {
      commit({ isStackFolded: !get().isStackFolded })
    },
    toToggleSidebar() {
      commit({ isSidebarOpen: !get().isSidebarOpen })
    },
    toToggleInspector() {
      commit({ isInspectorOpen: !get().isInspectorOpen })
    },
    toPatchFilter(patch) {
      commit({ filter: { ...get().filter, ...patch } })
    },
    toResetFilter() {
      commit({ filter: createFilter(), query: '' })
    },
    toSetQuery(query) {
      set({ query })
    },
    toSetAlbum(albumID) {
      commit({ activeAlbumID: albumID, activeSmartAlbumID: null })
    },
    toSetSmartAlbum(smartAlbumID) {
      commit({ activeSmartAlbumID: smartAlbumID, activeAlbumID: null })
    }
  }
})

export { MAX_COLUMNS, MIN_COLUMNS, useViewStore }
export type { ViewState }
