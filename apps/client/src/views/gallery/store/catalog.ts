import { create } from 'zustand'

import type { CatalogPayload, CuratePatch, GalleryRow } from '@/views/gallery/model/asset'
import {
  DELETE_GALLERY_ASSETS,
  GET_GALLERY_CATALOG,
  POST_GALLERY_CURATE,
  POST_GALLERY_IMPORT
} from '@/apis/gallery'

/**
 * catalog store：**唯一**的图库真相来源。
 *
 * 关键约束：写操作只就地 patch 命中的行，绝不 `toRead()` 全量重读 ——
 * 旧实现每次改一个星级都要重读整库，这是「改星级卡顿」的根因。
 */
interface CatalogState {
  rows: GalleryRow[]
  total: number
  probedCount: number
  loaded: boolean
  loading: boolean
  error: string | null
  toRead: () => Promise<void>
  toPatchRows: (ids: string[], patch: Partial<GalleryRow>) => void
  toCurate: (ids: string[], patch: CuratePatch) => Promise<void>
  toTrash: (ids: string[]) => Promise<{ trashed: number; failed: string[] }>
  toImportPaths: (paths: string[]) => Promise<{
    imported: number
    skipped: number
    failed: number
    /** 失败原因（去重后最多取前几条，用于 toast 说明“为什么没导进来”） */
    reasons: string[]
  }>
}

function applyPatch(rows: GalleryRow[], ids: string[], patch: Partial<GalleryRow>): GalleryRow[] {
  if (ids.length === 0) return rows
  const target = new Set(ids)
  return rows.map(function (row) {
    if (!target.has(row.id)) return row
    return { ...row, ...patch }
  })
}

const useCatalogStore = create<CatalogState>()(function (set, get) {
  return {
    rows: [],
    total: 0,
    probedCount: 0,
    loaded: false,
    loading: false,
    error: null,

    async toRead() {
      if (get().loading) return
      set({ loading: true, error: null })
      try {
        const payload: CatalogPayload = await GET_GALLERY_CATALOG()
        set({
          rows: payload.rows,
          total: payload.total,
          probedCount: payload.probedCount,
          loaded: true,
          loading: false
        })
      } catch (error) {
        console.error('[gallery] catalog 读取失败', error)
        set({ error: error instanceof Error ? error.message : String(error), loading: false })
      }
    },

    toPatchRows(ids, patch) {
      set(function (state) {
        return { rows: applyPatch(state.rows, ids, patch) }
      })
    },

    async toCurate(ids, patch) {
      if (ids.length === 0) return
      const before = get().rows
      // 乐观更新：先改内存，失败整批回滚
      const optimistic: Partial<GalleryRow> = {}
      if (patch.rating !== undefined) optimistic.rating = patch.rating
      if (patch.flag !== undefined) optimistic.flag = patch.flag
      if (patch.label !== undefined) optimistic.label = patch.label
      if (patch.hidden !== undefined) optimistic.hidden = patch.hidden
      if (patch.keep !== undefined) optimistic.keep = patch.keep
      set({ rows: applyPatch(before, ids, optimistic) })
      try {
        await POST_GALLERY_CURATE(ids, patch)
      } catch (error) {
        set({ rows: before, error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },

    async toTrash(ids) {
      const result = await DELETE_GALLERY_ASSETS(ids)
      const removed = new Set(ids)
      set(function (state) {
        const rows = state.rows.filter(function (row) {
          return !removed.has(row.id)
        })
        return { rows, total: rows.length }
      })
      return result
    },

    async toImportPaths(paths) {
      const outcome = await POST_GALLERY_IMPORT(paths)
      await get().toRead()
      const reasons: string[] = []
      for (const failure of outcome.failed) {
        if (!reasons.includes(failure.reason)) reasons.push(failure.reason)
        if (reasons.length >= 3) break
      }
      return {
        imported: outcome.imported,
        skipped: outcome.skipped,
        failed: outcome.failed.length,
        reasons
      }
    }
  }
})

export { useCatalogStore }
export type { CatalogState }
