import { describe, expect, it } from 'vitest'

import { findCaptureUsage, formatUsageBytes } from '@/features/capture/model/usage'
import type { GalleryMedia } from '@/views/gallery/model/media'

function makeMedia(
  id: string,
  kind: 'screenshot' | 'recording',
  size: number
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
      createdAt: 0,
      updatedAt: 0
    },
    kind: kind === 'recording' ? 'video' : 'image',
    meta: {
      source: 'capture',
      captureKind: kind
    },
    capturedAt: 0,
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
