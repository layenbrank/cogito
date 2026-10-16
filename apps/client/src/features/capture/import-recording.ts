import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { stat } from '@tauri-apps/plugin-fs'

import { CHANNELS } from '@/shared/ipc/channels'
import { VIDEO_EXTENSIONS } from '@/views/gallery/constraints'
import { findMimeFromPath, stringifyMeta, type GalleryAssetMeta } from '@/views/gallery/model/media'
import { probeVideoDurationMs } from '@/views/gallery/import-media'

const VIDEO_FILTER = [
  {
    name: '视频',
    extensions: [...VIDEO_EXTENSIONS]
  }
]

function findFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

/**
 * 导入外部录屏：原路径不动，isManaged=false，清理只删记录。
 */
async function pickAndImportRecordings(): Promise<string[]> {
  const picked = await dialogOpen({
    multiple: true,
    filters: VIDEO_FILTER
  })
  const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
  if (paths.length === 0) return []

  // 逐条入库彼此独立：并行发起，再按入参顺序过滤掉失败项
  const ids = await Promise.all(paths.map(insertRecordingPath))
  return ids.filter(function (id): id is string {
    return Boolean(id)
  })
}

async function insertRecordingPath(path: string): Promise<string | undefined> {
  try {
    const fileName = findFileName(path)
    const { mime, kind, extension } = findMimeFromPath(path)
    if (kind !== 'video') return undefined
    const src = convertFileSrc(path)
    let size: number | null = null
    try {
      const info = await stat(path)
      size = typeof info.size === 'number' ? info.size : null
    } catch (error) {
      console.warn('[capture] stat recording failed', path, error)
    }
    const capturedAt = Date.now()
    const meta: GalleryAssetMeta = {
      source: 'capture',
      isScreenshot: false,
      captureKind: 'recording',
      state: 'done',
      isManaged: false,
      capturedAt,
      dateSource: 'capture',
      keep: false,
      albums: [],
      durationMs: await probeVideoDurationMs(src)
    }
    const rows = await invoke<{ id: string }[]>(CHANNELS.ASSET.INSERT, {
      params: {
        filePath: path,
        fileName,
        mime,
        kind: 'video',
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
  } catch (error) {
    console.warn('[capture] insertRecordingPath failed', error)
    return undefined
  }
}

export { pickAndImportRecordings }
