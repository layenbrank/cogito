/**
 * 媒体领域 IPC：ffprobe / ffmpeg 导出 / LOD 抽帧 / 波形
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import { CHANNELS } from '@/shared/ipc/channels'
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
  return invoke<ProbeResult>(CHANNELS.MEDIA.PROBE, { path })
}

async function POST_MEDIA_EXPORT(args: ExportArgs): Promise<string> {
  return invoke<string>(CHANNELS.MEDIA.EXPORT, { args })
}

async function GET_MEDIA_FILMSTRIP(args: FilmstripFramesArgs): Promise<FilmstripFramesResult> {
  return invoke<FilmstripFramesResult>(CHANNELS.MEDIA.FILMSTRIP_FRAMES, { args })
}

async function GET_MEDIA_WAVEFORM(args: WaveformArgs): Promise<WaveformResult> {
  return invoke<WaveformResult>(CHANNELS.MEDIA.WAVEFORM, { args })
}

async function listenExportProgress(
  onProgress: (progress: number) => void
): Promise<UnlistenFn> {
  return listen<{ progress: number }>(EXPORT_PROGRESS_EVENT, function (event) {
    onProgress(event.payload.progress)
  })
}

// ------------------------------------------------------------ 文件 / 目录 / 批量改名

/** 原生选文件 / 选文件夹；返回路径数组（已由 Rust 侧登记授权） */
function GET_MEDIA_PICK(mode: 'files' | 'folders', extensions?: string[]): Promise<string[]> {
  return invoke<string[]>(CHANNELS.MEDIA.PICK, { mode, extensions })
}

function GET_MEDIA_STAT(path: string): Promise<{ size: number | null }> {
  return invoke<{ size: number | null }>(CHANNELS.MEDIA.STAT, { path })
}

function GET_MEDIA_SCAN_DIR(params: {
  dir: string
  extensions?: string[]
  maxDepth?: number
  maxFiles?: number
}): Promise<string[]> {
  return invoke<string[]>(CHANNELS.MEDIA.SCAN_DIR, params)
}

/** 批量改名第一步：只出计划（dry-run），不碰文件 */
function POST_MEDIA_RENAME_PLAN<T>(args: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MEDIA.RENAME_PLAN, { args })
}

function POST_MEDIA_RENAME_APPLY<T>(args: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MEDIA.RENAME_APPLY, { args })
}

/** 按 apply 返回的迁移日志反向操作 */
function POST_MEDIA_RENAME_UNDO<T>(args: unknown): Promise<T> {
  return invoke<T>(CHANNELS.MEDIA.RENAME_UNDO, { args })
}

const MediaIpc = {
  GET_MEDIA_PROBE,
  POST_MEDIA_EXPORT,
  GET_MEDIA_FILMSTRIP,
  GET_MEDIA_WAVEFORM,
  listenExportProgress
}

export {
  GET_MEDIA_PICK,
  GET_MEDIA_PROBE,
  GET_MEDIA_SCAN_DIR,
  GET_MEDIA_STAT,
  GET_MEDIA_WAVEFORM,
  GET_MEDIA_FILMSTRIP,
  POST_MEDIA_EXPORT,
  POST_MEDIA_RENAME_APPLY,
  POST_MEDIA_RENAME_PLAN,
  POST_MEDIA_RENAME_UNDO,
  MediaIpc,
  EXPORT_PROGRESS_EVENT,
  FILMSTRIP_FRAME_EVENT
}
export type {
  ProbeResult,
  FilmstripFramesArgs,
  FilmstripFrame,
  FilmstripFrameEvent,
  FilmstripFramesResult,
  WaveformArgs,
  WaveformResult
}
