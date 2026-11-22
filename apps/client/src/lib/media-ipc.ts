/**
 * 媒体领域 IPC：ffprobe / ffmpeg 导出 / LOD 抽帧 / 波形
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

interface FilmstripFramesArgs {
  path: string
  timesMs: number[]
  tileWidth?: number
  tileHeight?: number
  /** 与 `media:filmstrip-frame` 事件对应 */
  requestId?: string
}

interface FilmstripFrameEvent {
  requestId: string
  timeMs: number
  path: string
}

interface FilmstripFrame {
  timeMs: number
  path: string
}

interface FilmstripFramesResult {
  frames: FilmstripFrame[]
  tileWidth: number
  tileHeight: number
}

interface WaveformArgs {
  path: string
  width?: number
  height?: number
}

interface WaveformResult {
  wavePath: string
  width: number
  height: number
  durationMs: number
}

const EXPORT_PROGRESS_EVENT = 'media:export-progress'
const FILMSTRIP_FRAME_EVENT = 'media:filmstrip-frame'

async function GET_MEDIA_PROBE(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>('media:probe', { path })
}

async function POST_MEDIA_EXPORT(args: ExportArgs): Promise<string> {
  return invoke<string>('media:export', { args })
}

async function GET_MEDIA_FILMSTRIP(args: FilmstripFramesArgs): Promise<FilmstripFramesResult> {
  return invoke<FilmstripFramesResult>('media:filmstrip-frames', { args })
}

async function GET_MEDIA_WAVEFORM(args: WaveformArgs): Promise<WaveformResult> {
  return invoke<WaveformResult>('media:waveform', { args })
}

async function listenExportProgress(
  onProgress: (progress: number) => void
): Promise<UnlistenFn> {
  return listen<{ progress: number }>(EXPORT_PROGRESS_EVENT, function (event) {
    onProgress(event.payload.progress)
  })
}

const MediaIpc = {
  GET_MEDIA_PROBE,
  POST_MEDIA_EXPORT,
  GET_MEDIA_FILMSTRIP,
  GET_MEDIA_WAVEFORM,
  listenExportProgress
}

export { MediaIpc, EXPORT_PROGRESS_EVENT, FILMSTRIP_FRAME_EVENT }
export type {
  ProbeResult,
  FilmstripFramesArgs,
  FilmstripFrame,
  FilmstripFrameEvent,
  FilmstripFramesResult,
  WaveformArgs,
  WaveformResult
}
