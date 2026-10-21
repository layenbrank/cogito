import { invoke } from '@tauri-apps/api/core'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { stat } from '@tauri-apps/plugin-fs'

import { CHANNELS } from '@/shared/ipc/channels'
import { IMAGE_EXTENSIONS } from '@/views/gallery/constraints'
import { findMimeFromPath, stringifyMeta } from '@/views/gallery/model/media'

const IMAGE_FILTER = [
  {
    name: '图片',
    extensions: [...IMAGE_EXTENSIONS]
  }
]

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
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

export { pickAndImportImages }
