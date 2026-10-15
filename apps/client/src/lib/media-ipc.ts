/**
 * 媒体领域 IPC：ffprobe / ffmpeg 导出
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { ExportArgs } from '@/views/clipchamp/lib/export-graph'

interface ProbeResult {
  durationMs: number
  width?: number
  height?: number
  hasAudio: boolean
  hasVideo: boolean
}

const EXPORT_PROGRESS_EVENT = 'media:export-progress'

async function probe(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('media:probe', { path })
}

async function exportVideo(args: ExportArgs): Promise<string> {
  return invoke<string>('media:export', { args })
}

async function listenExportProgress(
  onProgress: (progress: number) => void
): Promise<UnlistenFn> {
  return listen<{ progress: number }>(EXPORT_PROGRESS_EVENT, function (event) {
    onProgress(event.payload.progress)
  })
}

const MediaIpc = {
  probe,
  exportVideo,
  listenExportProgress
}

export { MediaIpc, EXPORT_PROGRESS_EVENT }
export type { ProbeResult }
