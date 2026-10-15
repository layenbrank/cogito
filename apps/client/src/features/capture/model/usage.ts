import type { CaptureKind, GalleryMedia } from '@/views/gallery/model/media'

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

export { findCaptureUsage, formatUsageBytes }
export type { CaptureUsage, KindUsage }
