import { convertFileSrc, invoke } from '@tauri-apps/api/core'

import { CHANNELS } from '@/shared/ipc/channels'
import {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '@/views/gallery/constraints'
import {
  findMimeFromPath,
  stringifyMeta,
  type GalleryAssetMeta
} from '@/views/gallery/model/media'
import { probeCapturedAt } from '@/views/gallery/model/probe-date'

/**
 * 图库导入：选目录 / 递归收集 / stat 全部由 Rust 执行
 * （`media:pick` / `media:scanDir` / `media:stat`）。
 *
 * 渲染进程不再持有任意路径读盘能力 —— 收 `fs:scope` 之后它会被拦，而放行整盘等于没收。
 * 这里只负责：拿路径 → 探测（mime / 拍摄时间 / 时长）→ `asset:insert` 入库。
 */
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]
const MAX_FOLDER_DEPTH = 4
const MAX_FOLDER_FILES = 400

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function probeVideoDurationMs(src: string): Promise<number | undefined> {
  return new Promise(function (resolve) {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    const finish = function (durationMs?: number) {
      video.removeAttribute('src')
      video.load()
      resolve(durationMs)
    }
    video.onloadedmetadata = function () {
      const seconds = video.duration
      if (!Number.isFinite(seconds) || seconds <= 0) {
        finish(undefined)
        return
      }
      finish(Math.round(seconds * 1000))
    }
    video.onerror = function () {
      finish(undefined)
    }
    video.src = src
  })
}

async function insertMediaPath(path: string): Promise<string | undefined> {
  const fileName = findFileName(path)
  const { mime, kind, extension } = findMimeFromPath(path)
  const src = convertFileSrc(path)
  const probed = await probeCapturedAt(path, kind)
  let size: number | null = null
  try {
    const info = await invoke<{ size: number | null }>(CHANNELS.MEDIA.STAT, { path })
    size = typeof info.size === 'number' ? info.size : null
  } catch (error) {
    console.warn('[gallery] stat size failed', path, error)
  }

  const meta: GalleryAssetMeta = {
    source: 'import',
    capturedAt: probed.at,
    dateSource: probed.source,
    hidden: false
  }
  if (kind === 'video') {
    meta.durationMs = await probeVideoDurationMs(src)
  }

  const rows = await invoke<{ id: string }[]>(CHANNELS.ASSET.INSERT, {
    params: {
      filePath: path,
      fileName,
      mime,
      kind,
      hash: null,
      sha: null,
      size,
      index: null,
      extension,
      metadata: stringifyMeta(meta),
      status: null,
      deviceID: null,
      archivedAt: null,
      tenantID: null
    }
  })
  return rows[0]?.id
}

async function scanFolder(dir: string): Promise<string[]> {
  return invoke<string[]>(CHANNELS.MEDIA.SCAN_DIR, {
    dir,
    extensions: MEDIA_EXTENSIONS,
    maxDepth: MAX_FOLDER_DEPTH,
    maxFiles: MAX_FOLDER_FILES
  })
}

async function importPaths(paths: string[]): Promise<string[]> {
  // 逐条入库彼此独立：并行发起，再按入参顺序过滤掉失败项
  const ids = await Promise.all(paths.map(insertMediaPath))
  return ids.filter(function (id): id is string {
    return Boolean(id)
  })
}

async function pickAndImportFiles(): Promise<string[]> {
  const paths = await invoke<string[]>(CHANNELS.MEDIA.PICK, {
    mode: 'files',
    extensions: MEDIA_EXTENSIONS
  })
  if (paths.length === 0) return []
  return importPaths(paths)
}

async function pickAndImportFolders(): Promise<string[]> {
  const dirs = await invoke<string[]>(CHANNELS.MEDIA.PICK, { mode: 'folders' })
  if (dirs.length === 0) return []

  // 每个目录一次 Rust 扫描：深度/数量上限在 Rust 侧执行，前端不再递归读盘
  const buckets = await Promise.all(dirs.map(scanFolder))
  const files = buckets.flat()
  if (files.length === 0) return []
  return importPaths(files)
}

export {
  MAX_FOLDER_FILES,
  pickAndImportFiles,
  pickAndImportFolders,
  probeVideoDurationMs
}
