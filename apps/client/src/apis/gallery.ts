import { invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import type {
  CatalogPayload,
  CuratePatch,
  GalleryDetails,
  GalleryRootRow,
  ImportOutcome,
  SmartAlbumRow
} from '@/views/gallery/model/asset'

/**
 * 图库 IPC 的唯一出口。
 *
 * 前端不直接 `invoke` —— 频道名只在这里出现一次，`channels.contract.test.ts`
 * 再去 Rust 源码里比对，任何「名字对不上」都会在单测里炸掉而不是运行时静默失败。
 */

function GET_GALLERY_CATALOG(): Promise<CatalogPayload> {
  return invoke<CatalogPayload>(CHANNELS.GALLERY.CATALOG)
}

function GET_GALLERY_DETAILS(ids: string[]): Promise<GalleryDetails[]> {
  return invoke<GalleryDetails[]>(CHANNELS.GALLERY.DETAILS, { ids })
}

function POST_GALLERY_CURATE(ids: string[], patch: CuratePatch): Promise<string[]> {
  return invoke<string[]>(CHANNELS.GALLERY.CURATE, { args: { ids, patch } })
}

function GET_GALLERY_SEARCH(text: string): Promise<string[]> {
  return invoke<string[]>(CHANNELS.GALLERY.SEARCH, { text })
}

function POST_GALLERY_ALBUM(ids: string[], albumID: string): Promise<number> {
  return invoke<number>(CHANNELS.GALLERY.ALBUM_ATTACH, { args: { ids, albumID } })
}

function DELETE_GALLERY_ALBUM(ids: string[], albumID: string): Promise<number> {
  return invoke<number>(CHANNELS.GALLERY.ALBUM_DETACH, { args: { ids, albumID } })
}

function GET_GALLERY_SMART_ALBUMS(): Promise<SmartAlbumRow[]> {
  return invoke<SmartAlbumRow[]>(CHANNELS.GALLERY.SMART_ALBUMS_READ)
}

function POST_GALLERY_SMART_ALBUM(input: {
  id?: string
  name: string
  query: string
  index?: number
}): Promise<string> {
  return invoke<string>(CHANNELS.GALLERY.SMART_ALBUMS_SAVE, { input })
}

function DELETE_GALLERY_SMART_ALBUM(id: string): Promise<boolean> {
  return invoke<boolean>(CHANNELS.GALLERY.SMART_ALBUMS_REMOVE, { id })
}

function GET_GALLERY_ROOTS(): Promise<GalleryRootRow[]> {
  return invoke<GalleryRootRow[]>(CHANNELS.GALLERY.ROOTS_READ)
}

function POST_GALLERY_ROOT(path: string): Promise<string> {
  return invoke<string>(CHANNELS.GALLERY.ROOTS_ADD, { path })
}

function DELETE_GALLERY_ROOT(id: string): Promise<boolean> {
  return invoke<boolean>(CHANNELS.GALLERY.ROOTS_REMOVE, { id })
}

function PATCH_GALLERY_MISSING(ids: string[], missing: boolean): Promise<number> {
  return invoke<number>(CHANNELS.GALLERY.MARK_MISSING, { ids, missing })
}

/** 导入：路径由 `media:pick` 选好（选即授权），Rust 侧一次事务写库 + 探测。 */
function POST_GALLERY_IMPORT(paths: string[]): Promise<ImportOutcome> {
  return invoke<ImportOutcome>(CHANNELS.GALLERY.IMPORT, { paths })
}

/** 移到系统回收站（含成组成员由 Rust 侧按 stackID 展开）。 */
function DELETE_GALLERY_ASSETS(ids: string[]): Promise<{ trashed: number; failed: string[] }> {
  return invoke<{ trashed: number; failed: string[] }>(CHANNELS.GALLERY.TRASH, { ids })
}

/** 字节级去重：写 contentHash + dupGroup（纯派生物，可重跑）。 */
function POST_GALLERY_DEDUPE(): Promise<{ hashed: number; duplicated: number; groups: number }> {
  return invoke<{ hashed: number; duplicated: number; groups: number }>(CHANNELS.GALLERY.DEDUPE)
}

/** 感知哈希批量计算（可传 limit 分批跑）。 */
function POST_GALLERY_PHASH(limit?: number): Promise<number> {
  return invoke<number>(CHANNELS.GALLERY.COMPUTE_PHASH, { limit })
}

/** 相似图：返回按汉明距离升序的 id（最多 63 条）。 */
function GET_GALLERY_SIMILAR(id: string, maxDistance?: number): Promise<{ id: string; distance: number }[]> {
  return invoke<{ id: string; distance: number }[]>(CHANNELS.GALLERY.SIMILAR, {
    id,
    maxDistance
  })
}

/** 位置失效重扫：标记 missing / 自动恢复。 */
function POST_GALLERY_RESCAN(): Promise<{ checked: number; missing: number; restored: number }> {
  return invoke<{ checked: number; missing: number; restored: number }>(CHANNELS.GALLERY.RESCAN)
}

// 选文件 / 改名等媒体能力统一在 `@/apis/media`

// 相簿不另造一套：统一用 `@/apis/album` 的 GET_ALBUMS / POST_ALBUMS / DELETE_ALBUMS

export {
  POST_GALLERY_ROOT,
  POST_GALLERY_ALBUM,
  POST_GALLERY_PHASH,
  POST_GALLERY_CURATE,
  POST_GALLERY_DEDUPE,
  DELETE_GALLERY_ALBUM,
  GET_GALLERY_SIMILAR,
  POST_GALLERY_IMPORT,
  PATCH_GALLERY_MISSING,
  GET_GALLERY_CATALOG,
  GET_GALLERY_DETAILS,
  GET_GALLERY_ROOTS,
  GET_GALLERY_SMART_ALBUMS,
  DELETE_GALLERY_ROOT,
  DELETE_GALLERY_SMART_ALBUM,
  POST_GALLERY_RESCAN,
  POST_GALLERY_SMART_ALBUM,
  GET_GALLERY_SEARCH,
  DELETE_GALLERY_ASSETS
}
