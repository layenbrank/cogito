import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { readDir, stat } from '@tauri-apps/plugin-fs'

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

const MEDIA_FILTER = [
  {
    name: '媒体',
    extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]
  }
]

const MEDIA_EXT = new Set<string>([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS])
const MAX_FOLDER_DEPTH = 4
const MAX_FOLDER_FILES = 400

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function findExt(name: string): string {
  const parts = name.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1]!.toLowerCase()
}

function isMediaFile(name: string): boolean {
  return MEDIA_EXT.has(findExt(name))
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
    const info = await stat(path)
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

async function collectMediaInFolder(
  dir: string,
  depth: number,
  out: string[]
): Promise<void> {
  if (depth > MAX_FOLDER_DEPTH || out.length >= MAX_FOLDER_FILES) return
  const entries = await readDir(dir)
  for (const entry of entries) {
    if (out.length >= MAX_FOLDER_FILES) return
    const child = await join(dir, entry.name)
    if (entry.isDirectory) {
      await collectMediaInFolder(child, depth + 1, out)
      continue
    }
    if (entry.isFile && isMediaFile(entry.name)) {
      out.push(child)
    }
  }
}

async function importPaths(paths: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const path of paths) {
    const id = await insertMediaPath(path)
    if (id) ids.push(id)
  }
  return ids
}

async function pickAndImportFiles(): Promise<string[]> {
  const picked = await dialogOpen({
    multiple: true,
    filters: MEDIA_FILTER
  })
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
  if (paths.length === 0) return []
  return importPaths(paths)
}

async function pickAndImportFolders(): Promise<string[]> {
  const picked = await dialogOpen({
    directory: true,
    multiple: true
  })
  const dirs = Array.isArray(picked) ? picked : picked ? [picked] : []
  if (dirs.length === 0) return []

  const files: string[] = []
  for (const dir of dirs) {
    await collectMediaInFolder(dir, 0, files)
  }
  if (files.length === 0) return []
  return importPaths(files)
}

/** @deprecated 使用 pickAndImportFiles */
async function pickAndImportMedias(): Promise<string[]> {
  return pickAndImportFiles()
}

export {
  MAX_FOLDER_FILES,
  pickAndImportFiles,
  pickAndImportFolders,
  pickAndImportMedias,
  probeVideoDurationMs
}
