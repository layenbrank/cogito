import { describe, expect, it } from 'vitest'

import {
  buildCaptureByteSeries,
  buildUsageShare,
  findCaptureUsage,
  formatUsageBytes
} from '@/features/capture/model/usage'
import type { GalleryMedia } from '@/views/gallery/model/media'

function makeMedia(
  id: string,
  kind: 'screenshot' | 'recording',
  size: number,
  capturedAt = 0
): GalleryMedia {
  return {
    asset: {
      id,
      tenantID: null,
      kind: kind === 'recording' ? 'video' : 'image',
      hash: null,
      sha: '',
      size,
      index: 0,
      mime: kind === 'recording' ? 'video/mp4' : 'image/png',
      extension: kind === 'recording' ? 'mp4' : 'png',
      fileName: id,
      filePath: `/captures/${id}`,
      metadata: null,
      status: '001',
      deviceID: null,
      archivedAt: null,
      createdAt: capturedAt,
      updatedAt: capturedAt
    },
    kind: kind === 'recording' ? 'video' : 'image',
    meta: {
      source: 'capture',
      captureKind: kind
    },
    capturedAt,
    src: ''
  }
}

describe('findCaptureUsage', function () {
  it('sums by kind', function () {
    const usage = findCaptureUsage([
      makeMedia('a', 'screenshot', 10),
      makeMedia('b', 'screenshot', 20),
      makeMedia('c', 'recording', 100)
    ])
    expect(usage.screenshot).toEqual({ count: 2, bytes: 30 })
    expect(usage.recording).toEqual({ count: 1, bytes: 100 })
    expect(usage.total).toEqual({ count: 3, bytes: 130 })
  })
})

describe('formatUsageBytes', function () {
  it('formats mb and gb', function () {
    expect(formatUsageBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatUsageBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GB')
  })
})

describe('buildCaptureByteSeries', function () {
  it('buckets screenshot bytes by day in MB', function () {
    const now = Date.UTC(2026, 9, 27, 12, 0, 0)
    const today = Date.UTC(2026, 9, 27, 8, 0, 0)
    const points = buildCaptureByteSeries(
      [
        makeMedia('a', 'screenshot', 2 * 1024 * 1024, today),
        makeMedia('b', 'recording', 9 * 1024 * 1024, today)
      ],
      'screenshot',
      3,
      now
    )
    expect(points).toHaveLength(3)
    expect(points[2]?.value).toBe(2)
    expect(points[0]?.value).toBe(0)
  })
})

describe('buildUsageShare', function () {
  it('splits used and remaining', function () {
    expect(buildUsageShare(25, 100)).toEqual([
      { name: '已用', value: 25 },
      { name: '剩余', value: 75 }
    ])
  })
})
