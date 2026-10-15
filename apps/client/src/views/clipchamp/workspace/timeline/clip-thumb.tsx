import { useEffect, useRef, useState } from 'react'

import type { Clip, MediaAsset } from '@/views/clipchamp/lib/project'

const TILE_WIDTH = 44
const WAVE_CACHE = new Map<string, Float32Array>()
const WAVE_PENDING = new Map<string, Promise<Float32Array>>()

interface ClipFilmstripProps {
  asset: MediaAsset
  clip: Clip
  widthPx: number
}

/** 视频/图片轨胶片条缩略图 */
function ClipFilmstrip(props: ClipFilmstripProps) {
  const { asset, clip, widthPx } = props
  const count = Math.min(20, Math.max(1, Math.ceil(widthPx / TILE_WIDTH)))
  const spanSec = Math.max(0.05, clip.durationMs / 1000)

  if (asset.kind === 'image') {
    return (
      <div className="pointer-events-none absolute inset-0 flex overflow-hidden">
        {Array.from({ length: count }, function (_, index) {
          return (
            <img
              key={index}
              src={asset.thumbUrl}
              alt=""
              className="h-full shrink-0 object-cover"
              style={{ width: TILE_WIDTH }}
              draggable={false}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-0 flex overflow-hidden">
      {Array.from({ length: count }, function (_, index) {
        const ratio = count <= 1 ? 0 : index / (count - 1)
        const seekSec = clip.sourceInMs / 1000 + spanSec * ratio
        return (
          <FilmTile
            key={`${asset.id}-${index}`}
            src={asset.thumbUrl || ''}
            seekSec={seekSec}
          />
        )
      })}
    </div>
  )
}

interface FilmTileProps {
  src: string
  seekSec: number
}

function FilmTile(props: FilmTileProps) {
  const { src, seekSec } = props
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(
    function () {
      const video = videoRef.current
      if (!video || !src) return

      function seek() {
        if (!video) return
        try {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = Math.min(Math.max(0, seekSec), Math.max(0, video.duration - 0.05))
          }
        } catch (error) {
          console.debug('[clipchamp] film tile seek skipped', error)
        }
      }

      if (video.readyState >= 1) seek()
      else video.addEventListener('loadedmetadata', seek, { once: true })
    },
    [src, seekSec]
  )

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="metadata"
      className="h-full shrink-0 object-cover"
      style={{ width: TILE_WIDTH }}
    />
  )
}

interface ClipWaveformProps {
  asset: MediaAsset
  clip: Clip
  widthPx: number
  className?: string
}

/** 音频轨真实波形缩略图 */
function ClipWaveform(props: ClipWaveformProps) {
  const { asset, clip, widthPx, className } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)

  useEffect(
    function () {
      const url = asset.thumbUrl
      if (!url) return
      let cancelled = false

      void fetchWavePeaks(url, 256).then(function (next) {
        if (!cancelled) setPeaks(next)
      })

      return function () {
        cancelled = true
      }
    },
    [asset.thumbUrl]
  )

  useEffect(
    function () {
      const canvas = canvasRef.current
      if (!canvas || !peaks || peaks.length === 0) return

      const dpr = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.floor(widthPx))
      const height = Math.max(1, canvas.clientHeight || 28)
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const totalMs = Math.max(1, asset.durationMs || clip.durationMs)
      const startRatio = clip.sourceInMs / totalMs
      const endRatio = Math.min(1, (clip.sourceInMs + clip.durationMs) / totalMs)
      const start = Math.floor(startRatio * peaks.length)
      const end = Math.max(start + 1, Math.ceil(endRatio * peaks.length))
      const slice = peaks.subarray(start, end)
      const bars = Math.max(8, Math.floor(width / 2))
      const mid = height / 2
      const gap = 0.5

      ctx.fillStyle = 'rgba(16, 185, 129, 0.85)'
      for (let i = 0; i < bars; i++) {
        const sampleStart = Math.floor((i / bars) * slice.length)
        const sampleEnd = Math.max(
          sampleStart + 1,
          Math.floor(((i + 1) / bars) * slice.length)
        )
        let max = 0
        for (let s = sampleStart; s < sampleEnd && s < slice.length; s++) {
          max = Math.max(max, slice[s] || 0)
        }
        const amp = Math.max(1.5, max * (height * 0.9))
        const x = (i / bars) * width
        const barW = Math.max(1, width / bars - gap)
        ctx.fillRect(x, mid - amp / 2, barW, amp)
      }
    },
    [peaks, widthPx, asset.durationMs, clip.sourceInMs, clip.durationMs]
  )

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
      style={{ width: widthPx }}
      aria-hidden
    />
  )
}

async function fetchWavePeaks(url: string, buckets: number): Promise<Float32Array> {
  const cached = WAVE_CACHE.get(url)
  if (cached) return cached

  const pending = WAVE_PENDING.get(url)
  if (pending) return pending

  const task = (async function () {
    try {
      const response = await fetch(url)
      const buffer = await response.arrayBuffer()
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const context = new AudioCtx()
      const decoded = await context.decodeAudioData(buffer.slice(0))
      await context.close().catch(function () {})
      const channel = decoded.getChannelData(0)
      const peaks = downsamplePeaks(channel, buckets)
      WAVE_CACHE.set(url, peaks)
      return peaks
    } catch (error) {
      console.warn('[clipchamp] waveform decode failed, using placeholder', error)
      const fallback = new Float32Array(buckets)
      for (let i = 0; i < buckets; i++) {
        fallback[i] = 0.15 + 0.35 * Math.abs(Math.sin(i * 0.45))
      }
      WAVE_CACHE.set(url, fallback)
      return fallback
    } finally {
      WAVE_PENDING.delete(url)
    }
  })()

  WAVE_PENDING.set(url, task)
  return task
}

function downsamplePeaks(samples: Float32Array, buckets: number): Float32Array {
  const peaks = new Float32Array(buckets)
  const block = Math.max(1, Math.floor(samples.length / buckets))
  for (let i = 0; i < buckets; i++) {
    const start = i * block
    const end = Math.min(samples.length, start + block)
    let max = 0
    for (let s = start; s < end; s++) {
      max = Math.max(max, Math.abs(samples[s] || 0))
    }
    peaks[i] = max
  }
  return peaks
}

export { ClipFilmstrip, ClipWaveform }
