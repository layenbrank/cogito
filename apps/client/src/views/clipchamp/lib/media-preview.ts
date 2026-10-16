/**
 * 素材预览：LOD 按需抽帧 + 波形。
 *
 * ## CapCut × Premiere 混合规格（胶片条）
 *
 * | 维度 | CapCut | Premiere | 我们取 |
 * | --- | --- | --- | --- |
 * | 默认模式 | 常开连续胶片 | Head / Head+Tail / Continuous 可选 | 常开 Continuous（CapCut） |
 * | 格几何 | 轨高×素材比，cover 裁切不拉伸 | 轨高决定格高，zoom 决定格数 | 格宽=轨高×aspect，cover blit |
 * | 密度 | 缩放改变「一屏几格」 | 「帧数对应时间标尺单位」 | 缩放→格数变；抽帧时间量化到 LOD 桶 |
 * | 加载 | 视口优先、滚动即补 | 渐进生成、滚/缩不闪 | 先疏后密；每帧事件即画；nearest 顶上；缓存不清 |
 * | 音频 | 波形轨 | 波形轨 | 独立波形，不混进胶片 |
 * | 性能 | 消费级常开要快 | 重时间线可关 Continuous | 首批约 4 帧先铺满视口，其余在原位变清晰 |
 *
 * LOD：idealMs = cellW/pxPerMs，再 snap 到桶，使微缩放复用缓存（Premiere），
 * 绘制仍按比例格铺满（CapCut），缺帧用 nearest。
 */
import { convertFileSrc } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { FILMSTRIP_FRAME_EVENT, MediaIpc, type FilmstripFrameEvent } from '@/lib/media-ipc'
import type { MediaAsset, WaveformMeta } from '@/views/clipchamp/lib/project'

const ASPECT_FALLBACK = 16 / 9
/** 单次 IPC 上限；长片靠 LOD 10s 把视口压进这个数 */
const MAX_TIMES_PER_REQUEST = 120
/** 抽帧纹理分辨率（与绘制格宽无关，只影响清晰度） */
const FRAME_TEX_W = 160
const FRAME_TEX_H = 90

/**
 * Premiere 式离散取样桶（ms）。
 * 最密 0.5s（近景可读），默认区 2–3s，最疏 10s（远景预算）。
 */
const LOD_INTERVALS_MS = [500, 1000, 2000, 3000, 5000, 10000] as const

const WAVEFORM_PENDING = new Map<string, Promise<WaveformMeta | null>>()
const FRAME_URL_CACHE = new Map<string, string>()
const BATCH_PENDING = new Map<string, Promise<void>>()
const BATCH_LISTENERS = new Map<string, Set<(timeMs: number, url: string) => void>>()

function findFrameAspect(asset: MediaAsset): number {
  if (asset.width && asset.height && asset.height > 0) {
    return asset.width / asset.height
  }
  return ASPECT_FALLBACK
}

/** CapCut：格宽只跟轨高和素材比例有关，绝不按时间槽拉扁 */
function findFilmstripCellWidthPx(trackHeightPx: number, aspect: number): number {
  return Math.max(28, Math.round(trackHeightPx * aspect))
}

/** Premiere：把「一格占多少时间」量化到稳定桶，微缩放不重抽 */
function findFilmstripLodIntervalMs(cellWidthPx: number, pxPerMs: number): number {
  const ideal = Math.max(28, cellWidthPx) / Math.max(1e-6, pxPerMs)
  if (ideal <= LOD_INTERVALS_MS[0]) return LOD_INTERVALS_MS[0]
  for (const bucket of LOD_INTERVALS_MS) {
    if (bucket >= ideal) return bucket
  }
  return LOD_INTERVALS_MS[LOD_INTERVALS_MS.length - 1]
}

function snapSourceMs(sourceMs: number, lodMs: number): number {
  if (lodMs <= 0) return Math.max(0, Math.round(sourceMs))
  return Math.max(0, Math.round(sourceMs / lodMs) * lodMs)
}

interface FilmstripCell {
  /** 相对 clip 左缘的 x（CSS px） */
  x: number
  /** 绘制格宽（保持比例） */
  width: number
  /** 该格对应的源时间（已 LOD 量化） */
  sourceMs: number
}

/**
 * 视口 ∩ clip：CapCut 比例格铺满 + Premiere LOD 时间对齐。
 * 放大 → 格数变多 → idealMs 变小 → LOD 桶更密。
 */
function findFilmstripCells(input: {
  sourceInMs: number
  durationMs: number
  clipStartMs: number
  viewStartMs: number
  viewEndMs: number
  pxPerMs: number
  cellWidthPx: number
  speed?: number
}): FilmstripCell[] {
  const speed = Math.max(0.1, input.speed ?? 1)
  const cellW = Math.max(28, input.cellWidthPx)
  const lodMs = findFilmstripLodIntervalMs(cellW, input.pxPerMs)
  const clipSpanMs = input.durationMs / speed
  const clipEndMs = input.clipStartMs + clipSpanMs
  const visStart = Math.max(input.viewStartMs, input.clipStartMs)
  const visEnd = Math.min(input.viewEndMs, clipEndMs)
  if (visEnd <= visStart || input.pxPerMs <= 0) return []

  const localVisStartPx = (visStart - input.clipStartMs) * input.pxPerMs
  const localVisEndPx = (visEnd - input.clipStartMs) * input.pxPerMs
  const clipWidthPx = clipSpanMs * input.pxPerMs

  const firstIndex = Math.max(0, Math.floor(localVisStartPx / cellW))
  const lastIndex = Math.min(
    Math.ceil(localVisEndPx / cellW),
    Math.ceil(clipWidthPx / cellW)
  )

  const cells: FilmstripCell[] = []
  let lastSourceMs = Number.NaN
  for (let i = firstIndex; i < lastIndex && cells.length < MAX_TIMES_PER_REQUEST; i++) {
    const x = i * cellW
    const centerLocalMs = (x + cellW / 2) / input.pxPerMs
    const rawSourceMs = Math.max(0, input.sourceInMs + centerLocalMs * speed)
    const sourceMs = snapSourceMs(rawSourceMs, lodMs)
    // 同 LOD 时间只保留一格的请求语义：绘制仍按格铺，但 fetch 去重在外层
    if (sourceMs === lastSourceMs && cells.length > 0) {
      // 仍推入绘制格，共用同一 sourceMs
      cells.push({
        x,
        width: Math.min(cellW, Math.max(1, clipWidthPx - x)),
        sourceMs
      })
      continue
    }
    lastSourceMs = sourceMs
    cells.push({
      x,
      width: Math.min(cellW, Math.max(1, clipWidthPx - x)),
      sourceMs
    })
  }
  return cells
}

/** Premiere 防闪：缺精确帧时用最近已缓存帧 */
function findNearestFrame(
  images: Map<number, HTMLImageElement>,
  sourceMs: number
): HTMLImageElement | undefined {
  const exact = images.get(sourceMs)
  if (exact) return exact
  let best: HTMLImageElement | undefined
  let bestDist = Infinity
  for (const [timeMs, image] of images) {
    const dist = Math.abs(timeMs - sourceMs)
    if (dist < bestDist) {
      bestDist = dist
      best = image
    }
  }
  return best
}

function frameCacheKey(path: string, timeMs: number): string {
  return `${path}|${timeMs}|${FRAME_TEX_W}x${FRAME_TEX_H}`
}

/** 先取两端和中点，再逐级加密。第一批 ffmpeg 就能铺满整段。 */
function spreadTimes(timesMs: number[]): number[] {
  const unique = [...new Set(timesMs)].sort(function (a, b) {
    return a - b
  })
  const count = unique.length
  if (count <= 2) return unique
  const used = new Array<boolean>(count).fill(false)
  const ordered: number[] = []
  let step = count
  while (ordered.length < count) {
    step = Math.max(1, Math.floor(step / 2))
    for (let index = 0; index < count; index += step) {
      if (used[index]) continue
      used[index] = true
      ordered.push(unique[index])
    }
  }
  return ordered
}

async function fetchFilmstripFrames(
  request: {
    path: string
    timesMs: number[]
  },
  onFrame?: (timeMs: number, url: string) => void
): Promise<Map<number, string>> {
  const ready = new Map<number, string>()
  const missing: number[] = []
  const ordered = spreadTimes(request.timesMs)

  for (const timeMs of ordered) {
    const cached = FRAME_URL_CACHE.get(frameCacheKey(request.path, timeMs))
    if (cached) {
      ready.set(timeMs, cached)
      onFrame?.(timeMs, cached)
    } else {
      missing.push(timeMs)
    }
  }
  if (missing.length === 0) return ready

  const batchKey = `${request.path}|${missing.join(',')}`
  let listeners = BATCH_LISTENERS.get(batchKey)
  if (!listeners) {
    listeners = new Set()
    BATCH_LISTENERS.set(batchKey, listeners)
  }
  if (onFrame) listeners.add(onFrame)

  function publish(timeMs: number, url: string) {
    FRAME_URL_CACHE.set(frameCacheKey(request.path, timeMs), url)
    const group = BATCH_LISTENERS.get(batchKey)
    if (!group) return
    for (const listener of group) listener(timeMs, url)
  }

  const existing = BATCH_PENDING.get(batchKey)
  if (!existing) {
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const task = (async function () {
      const unlisten = await listen<FilmstripFrameEvent>(
        FILMSTRIP_FRAME_EVENT,
        function (event) {
          if (event.payload.requestId !== requestId) return
          publish(event.payload.timeMs, convertFileSrc(event.payload.path))
        }
      )
      try {
        const result = await MediaIpc.filmstripFrames({
          path: request.path,
          timesMs: missing,
          tileWidth: FRAME_TEX_W,
          tileHeight: FRAME_TEX_H,
          requestId
        })
        for (const frame of result.frames) {
          const key = frameCacheKey(request.path, frame.timeMs)
          if (FRAME_URL_CACHE.has(key)) continue
          publish(frame.timeMs, convertFileSrc(frame.path))
        }
      } finally {
        unlisten()
      }
    })()
      .catch(function (error) {
        console.warn('[clipchamp] filmstrip-frames failed', request.path, error)
      })
      .finally(function () {
        BATCH_PENDING.delete(batchKey)
        BATCH_LISTENERS.delete(batchKey)
      })
    BATCH_PENDING.set(batchKey, task)
    await task
  } else {
    await existing
  }

  if (onFrame) listeners.delete(onFrame)

  for (const timeMs of missing) {
    const cached = FRAME_URL_CACHE.get(frameCacheKey(request.path, timeMs))
    if (cached) {
      ready.set(timeMs, cached)
      onFrame?.(timeMs, cached)
    }
  }
  return ready
}

/** object-fit: cover，保持比例裁切，绝不拉伸变形 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  naturalWidth: number,
  naturalHeight: number
) {
  if (dw <= 0 || dh <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return
  const imageRatio = naturalWidth / naturalHeight
  const targetRatio = dw / dh
  let sx = 0
  let sy = 0
  let sw = naturalWidth
  let sh = naturalHeight
  if (imageRatio > targetRatio) {
    sw = naturalHeight * targetRatio
    sx = (naturalWidth - sw) / 2
  } else {
    sh = naturalWidth / targetRatio
    sy = (naturalHeight - sh) / 2
  }
  ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
}

async function ensureWaveform(asset: MediaAsset): Promise<WaveformMeta | null> {
  if (asset.kind === 'image') return null
  if (asset.kind === 'video' && asset.hasAudio === false) return null
  if (asset.waveform?.waveUrl) return asset.waveform

  const pending = WAVEFORM_PENDING.get(asset.path)
  if (pending) return pending

  const task = (async function () {
    try {
      const result = await MediaIpc.waveform({
        path: asset.path,
        width: 1280,
        height: 64
      })
      return {
        waveUrl: convertFileSrc(result.wavePath),
        wavePath: result.wavePath,
        width: result.width,
        height: result.height,
        durationMs: result.durationMs
      } satisfies WaveformMeta
    } catch (error) {
      console.warn('[clipchamp] waveform failed', asset.path, error)
      return null
    } finally {
      WAVEFORM_PENDING.delete(asset.path)
    }
  })()

  WAVEFORM_PENDING.set(asset.path, task)
  return task
}

export type { FilmstripCell }
export {
  findFrameAspect,
  findFilmstripCellWidthPx,
  findFilmstripLodIntervalMs,
  findFilmstripCells,
  findNearestFrame,
  fetchFilmstripFrames,
  drawImageCover,
  ensureWaveform
}
