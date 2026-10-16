import { useEffect, useRef, useState } from 'react'

import {
  drawImageCover,
  fetchFilmstripFrames,
  findFilmstripCellWidthPx,
  findFilmstripCells,
  findFrameAspect,
  findNearestFrame,
  ensureWaveform,
  type FilmstripCell
} from '@/views/clipchamp/lib/media-preview'
import type { Clip, MediaAsset, WaveformMeta } from '@/views/clipchamp/lib/project'

/** 单块胶片画布的像素上限。整段时间轴远超浏览器 canvas 尺寸时只画视口切片 */
const FILMSTRIP_CANVAS_MAX = 4096

function findFilmstripSlice(
  clipStartMs: number,
  widthPx: number,
  viewStartMs: number,
  viewEndMs: number,
  pxPerMs: number
) {
  const localStart = Math.max(0, (viewStartMs - clipStartMs) * pxPerMs)
  const localEnd = Math.min(widthPx, Math.max(localStart + 1, (viewEndMs - clipStartMs) * pxPerMs))
  return {
    localStart,
    width: Math.max(1, localEnd - localStart)
  }
}

interface ClipFilmstripProps {
  asset: MediaAsset
  clip: Clip
  widthPx: number
  pxPerMs: number
  viewStartMs: number
  viewEndMs: number
  /** 片段与滚动视口相交时才抽帧 */
  isInView: boolean
}

/**
 * 视频/图片轨胶片：CapCut 比例格 + Premiere LOD/防闪。
 * - 格宽 = 轨高 × 比例（cover，不拉伸）
 * - 抽帧时间量化到 LOD 桶；绘制缺帧用 nearest
 * - 仅 isInView 抽新帧；滚出不清缓存
 */
function ClipFilmstrip(props: ClipFilmstripProps) {
  const { asset, clip, widthPx, pxPerMs, viewStartMs, viewEndMs, isInView } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [cells, setCells] = useState<FilmstripCell[]>([])
  const [images, setImages] = useState<Map<number, HTMLImageElement>>(new Map())
  const imagesRef = useRef(images)
  useEffect(
    function () {
      imagesRef.current = images
    },
    [images]
  )
  const [cover, setCover] = useState<HTMLImageElement | null>(null)
  const aspect = findFrameAspect(asset)

  useEffect(
    function () {
      if (asset.kind === 'image') {
        const image = new Image()
        image.decoding = 'async'
        image.onload = function () {
          setCover(image)
        }
        image.src = asset.thumbUrl || ''
        return
      }

      // 未进入视口：保留已有格子/图，不抽新帧、不清空
      if (!isInView) return

      const canvas = canvasRef.current
      const trackHeight = Math.max(28, canvas?.clientHeight || 28)
      const cellWidthPx = findFilmstripCellWidthPx(trackHeight, aspect)
      const nextCells = findFilmstripCells({
        sourceInMs: clip.sourceInMs,
        durationMs: clip.durationMs,
        clipStartMs: clip.startMs,
        viewStartMs,
        viewEndMs,
        pxPerMs,
        cellWidthPx,
        speed: clip.speed
      })
      setCells(nextCells)

      const times = [
        ...new Set(
          nextCells.map(function (cell) {
            return cell.sourceMs
          })
        )
      ]
      if (times.length === 0) return

      // LOD 去重后：已有帧复用，只请求缺失时间点
      const missing = times.filter(function (timeMs) {
        return !imagesRef.current.has(timeMs)
      })
      if (missing.length === 0) return

      let cancelled = false
      const loading = new Set<number>()

      function acceptFrame(timeMs: number, url: string) {
        if (cancelled) return
        if (imagesRef.current.has(timeMs) || loading.has(timeMs)) return
        loading.add(timeMs)
        const image = new Image()
        image.decoding = 'async'
        image.onload = function () {
          if (cancelled) return
          setImages(function (prev) {
            if (prev.has(timeMs)) return prev
            const merged = new Map(prev)
            merged.set(timeMs, image)
            return merged
          })
        }
        image.onerror = function () {
          loading.delete(timeMs)
        }
        image.src = url
      }

      void fetchFilmstripFrames(
        {
          path: asset.path,
          timesMs: missing
        },
        acceptFrame
      )

      return function () {
        cancelled = true
      }
    },
    [
      asset.id,
      asset.path,
      asset.kind,
      asset.thumbUrl,
      asset.width,
      asset.height,
      aspect,
      clip.id,
      clip.sourceInMs,
      clip.durationMs,
      clip.startMs,
      clip.speed,
      pxPerMs,
      viewStartMs,
      viewEndMs,
      widthPx,
      isInView
    ]
  )

  const slice = findFilmstripSlice(clip.startMs, widthPx, viewStartMs, viewEndMs, pxPerMs)

  useEffect(
    function () {
      const canvas = canvasRef.current
      if (!canvas || slice.width < 1) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = slice.width
      const height = Math.max(1, canvas.clientHeight || 28)
      const bitmapScale = Math.min(dpr, FILMSTRIP_CANVAS_MAX / width)
      canvas.width = Math.max(1, Math.floor(width * bitmapScale))
      canvas.height = Math.max(1, Math.floor(height * bitmapScale))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(bitmapScale, 0, 0, bitmapScale, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = '#0a0a0a'
      ctx.fillRect(0, 0, width, height)

      if (asset.kind === 'image' && cover) {
        const cellW = findFilmstripCellWidthPx(
          height,
          cover.naturalWidth / Math.max(1, cover.naturalHeight)
        )
        const first = Math.max(0, Math.floor(slice.localStart / cellW))
        const last = Math.ceil((slice.localStart + width) / cellW)
        for (let i = first; i < last; i++) {
          const x = i * cellW - slice.localStart
          const w = Math.min(cellW, width - x)
          if (w <= 1) continue
          drawImageCover(ctx, cover, x, 0, w, height, cover.naturalWidth, cover.naturalHeight)
        }
        return
      }

      const drawCells =
        cells.length > 0
          ? cells
          : [...images.keys()]
              .sort(function (a, b) {
                return a - b
              })
              .map(function (sourceMs) {
                const speed = Math.max(0.1, clip.speed)
                const localMs = (sourceMs - clip.sourceInMs) / speed
                const cellW = findFilmstripCellWidthPx(height, aspect)
                return {
                  x: localMs * pxPerMs,
                  width: cellW,
                  sourceMs
                } satisfies FilmstripCell
              })

      for (const cell of drawCells) {
        const x = cell.x - slice.localStart
        if (x >= width || x + cell.width <= 0) continue
        const image = findNearestFrame(images, cell.sourceMs)
        if (!image) continue
        const dx = Math.max(0, x)
        const w = Math.min(cell.width - (dx - x), width - dx)
        if (w <= 1) continue
        drawImageCover(
          ctx,
          image,
          dx,
          0,
          w,
          height,
          image.naturalWidth,
          image.naturalHeight
        )
      }
    },
    [
      cells,
      images,
      cover,
      slice.localStart,
      slice.width,
      asset.kind,
      aspect,
      clip.sourceInMs,
      clip.speed,
      pxPerMs
    ]
  )

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute top-0 h-full"
      style={{ left: slice.localStart, width: slice.width }}
      aria-hidden
    />
  )
}

interface ClipWaveformProps {
  asset: MediaAsset
  clip: Clip
  widthPx: number
  onWaveform?: (meta: WaveformMeta) => void
}

function ClipWaveform(props: ClipWaveformProps) {
  const { asset, clip, widthPx, onWaveform } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [wave, setWave] = useState<HTMLImageElement | null>(null)
  const [meta, setMeta] = useState<WaveformMeta | null>(asset.waveform ?? null)

  useEffect(
    function () {
      let cancelled = false
      void (async function () {
        const next = asset.waveform ?? (await ensureWaveform(asset))
        if (cancelled || !next) return
        setMeta(next)
        if (!asset.waveform) onWaveform?.(next)
        const image = new Image()
        image.decoding = 'async'
        image.onload = function () {
          if (!cancelled) setWave(image)
        }
        image.src = next.waveUrl
      })()
      return function () {
        cancelled = true
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [asset.id, asset.path, asset.kind, asset.hasAudio, asset.waveform?.waveUrl]
  )

  useEffect(
    function () {
      const canvas = canvasRef.current
      if (!canvas || widthPx < 1) return
      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.floor(widthPx))
      const height = Math.max(1, canvas.clientHeight || 28)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      if (!wave || !meta) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.25)'
        ctx.fillRect(0, height / 2 - 1, width, 2)
        return
      }

      const totalMs = Math.max(1, meta.durationMs || asset.durationMs || clip.durationMs)
      const startRatio = Math.min(1, Math.max(0, clip.sourceInMs / totalMs))
      const spanRatio = Math.min(1 - startRatio, Math.max(0.001, clip.durationMs / totalMs))
      const sx = startRatio * wave.naturalWidth
      const sw = Math.max(1, spanRatio * wave.naturalWidth)
      ctx.drawImage(wave, sx, 0, sw, wave.naturalHeight, 0, 0, width, height)
    },
    [wave, meta, widthPx, clip.sourceInMs, clip.durationMs, asset.durationMs]
  )

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ width: widthPx }}
      aria-hidden
    />
  )
}

export { ClipFilmstrip, ClipWaveform }
