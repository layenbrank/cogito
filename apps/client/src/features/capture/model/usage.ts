import type { ChartPoint, NamedCount } from '@cogito/design/components/charts'

import type { CaptureKind, GalleryMedia } from '@/views/gallery/model/media'

const DAY_MS = 86_400_000
const USAGE_WINDOW = 14

interface KindUsage {
  count: number
  bytes: number
}

interface CaptureUsage {
  screenshot: KindUsage
  recording: KindUsage
  total: KindUsage
}

function emptyUsage(): KindUsage {
  return { count: 0, bytes: 0 }
}

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayLabel(ms: number) {
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

/**
 * 按 captureKind 汇总条数与占用。
 */
function findCaptureUsage(items: GalleryMedia[]): CaptureUsage {
  const screenshot = emptyUsage()
  const recording = emptyUsage()

  for (const media of items) {
    if (media.meta.source !== 'capture') continue
    const kind: CaptureKind = media.meta.captureKind ?? 'screenshot'
    const target = kind === 'recording' ? recording : screenshot
    target.count += 1
    target.bytes += media.asset.size ?? 0
  }

  return {
    screenshot,
    recording,
    total: {
      count: screenshot.count + recording.count,
      bytes: screenshot.bytes + recording.bytes
    }
  }
}

/** 近窗每日新增占用（MB），供趋势图；kind 缺省为全部 capture */
function buildCaptureByteSeries(
  items: GalleryMedia[],
  kind?: CaptureKind,
  windowDays = USAGE_WINDOW,
  now = Date.now()
): ChartPoint[] {
  const start = startOfDay(now) - (windowDays - 1) * DAY_MS
  const buckets = new Map<string, number>()
  for (let i = 0; i < windowDays; i += 1) {
    buckets.set(dayLabel(start + i * DAY_MS), 0)
  }

  for (const media of items) {
    if (media.meta.source !== 'capture') continue
    const mediaKind: CaptureKind = media.meta.captureKind ?? 'screenshot'
    if (kind && mediaKind !== kind) continue
    const at = media.capturedAt
    if (at < start) continue
    const label = dayLabel(startOfDay(at))
    if (!buckets.has(label)) continue
    buckets.set(label, (buckets.get(label) ?? 0) + (media.asset.size ?? 0))
  }

  return [...buckets.entries()].map(function ([label, bytes]) {
    return {
      label,
      /** 以 MB 为纵轴，避免大整数把刻度压扁 */
      value: Math.round((bytes / (1024 * 1024)) * 100) / 100
    }
  })
}

/** 已用 / 剩余，供饼图；单位与 `used`/`max` 一致（字节） */
function buildUsageShare(used: number, max: number): NamedCount[] {
  const safeUsed = Math.max(0, used)
  const safeMax = Math.max(0, max)
  const remaining = Math.max(0, safeMax - safeUsed)
  const items: NamedCount[] = []
  if (safeUsed > 0) items.push({ name: '已用', value: safeUsed })
  if (remaining > 0) items.push({ name: '剩余', value: remaining })
  if (items.length === 0) items.push({ name: '空闲', value: 1 })
  return items
}

function formatUsageBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${bytes} B`
}

export {
  USAGE_WINDOW,
  buildCaptureByteSeries,
  buildUsageShare,
  findCaptureUsage,
  formatUsageBytes
}
export type { CaptureUsage, KindUsage }
