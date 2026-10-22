import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, join } from '@tauri-apps/api/path'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, exists, mkdir, writeFile, stat } from '@tauri-apps/plugin-fs'

import { CHANNELS } from '@/shared/ipc/channels'
import { IMAGE_EXTENSIONS } from '@/views/gallery/constraints'
import { findMimeFromPath, stringifyMeta } from '@/views/gallery/model/media'

const IMAGE_FILTER = [
  {
    name: '图片',
    extensions: [...IMAGE_EXTENSIONS]
  }
]

/** 粘贴 / 拖入单张上限（与 markdown 插图同量级） */
const IMAGE_MAX_SIZE = 20 * 1024 * 1024

const PASTE_DIR = 'signboard'

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic'
}

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

function findExtensionFromMime(mime: string, fileName?: string): string {
  const fromMime = MIME_EXTENSION[mime.toLowerCase()]
  if (fromMime) return fromMime
  if (fileName) {
    const parts = fileName.split('.')
    if (parts.length > 1) {
      const ext = parts[parts.length - 1]?.toLowerCase()
      if (ext && (IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return ext
    }
  }
  return 'png'
}

async function insertImagePath(path: string): Promise<string | undefined> {
  const fileName = findFileName(path)
  const { mime, kind, extension } = findMimeFromPath(path)
  if (kind !== 'image') return undefined

  let size: number | null = null
  try {
    const info = await stat(path)
    size = typeof info.size === 'number' ? info.size : null
  } catch {
    size = null
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
      metadata: stringifyMeta({ source: 'import', hidden: false }),
      status: null,
      deviceID: null,
      archivedAt: null,
      tenantID: null
    }
  })
  return rows[0]?.id
}

async function findPasteDir(): Promise<string> {
  if (!(await exists(PASTE_DIR, { baseDir: BaseDirectory.AppLocalData }))) {
    await mkdir(PASTE_DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true })
  }
  const root = await appLocalDataDir()
  return join(root, PASTE_DIR)
}

/** 把浏览器 File（粘贴 / 拖入）落到 AppLocalData/signboard/ 再入库。 */
async function insertImageFile(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  if (file.size > IMAGE_MAX_SIZE) {
    throw new Error(`图片超过 ${Math.round(IMAGE_MAX_SIZE / (1024 * 1024))}MB 上限`)
  }

  const extension = findExtensionFromMime(file.type, file.name)
  const stamp = Date.now()
  const base =
    file.name && !file.name.startsWith('image.')
      ? findFileName(file.name).replace(/\.[^.]+$/, '')
      : `paste-${stamp}`
  const fileName = `${base}.${extension}`
  const dir = await findPasteDir()
  const filePath = await join(dir, `${stamp}-${fileName}`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  await writeFile(filePath, bytes)
  return insertImagePath(filePath)
}

/** 从 DataTransfer / clipboardData 抽出图片 File（兼容 files 与 items）。 */
function findImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []

  const fromFiles = Array.from(data.files ?? []).filter(function (file) {
    return file.type.startsWith('image/')
  })
  if (fromFiles.length > 0) return fromFiles

  const fromItems: File[] = []
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) fromItems.push(file)
  }
  return fromItems
}

/** 从本机选图并写入 asset，返回新建 id 列表。 */
async function pickAndImportImages(): Promise<string[]> {
  const picked = await dialogOpen({
    multiple: true,
    filters: IMAGE_FILTER
  })
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
  if (paths.length === 0) return []
  const ids = await Promise.all(paths.map(insertImagePath))
  return ids.filter(function (id): id is string {
    return Boolean(id)
  })
}

/** 粘贴 / 拖入的 File 列表写入 asset。 */
async function importImageFiles(files: File[]): Promise<string[]> {
  const images = files.filter(function (file) {
    return file.type.startsWith('image/')
  })
  if (images.length === 0) return []
  const ids = await Promise.all(images.map(insertImageFile))
  return ids.filter(function (id): id is string {
    return Boolean(id)
  })
}

export {
  IMAGE_MAX_SIZE,
  findImageFiles,
  importImageFiles,
  pickAndImportImages
}
