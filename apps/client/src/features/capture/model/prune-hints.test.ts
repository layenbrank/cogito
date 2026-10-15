import { describe, expect, it } from 'vitest'

import { findPruneHints } from '@/features/capture/model/prune-hints'
import type { GalleryMedia } from '@/views/gallery/model/media'

function makeMedia(
  id: string,
  capturedAt: number,
  size: number,
  extras: Partial<GalleryMedia['meta']> = {}
): GalleryMedia {
  return {
    asset: {
      id,
      tenantID: null,
      kind: 'image',
      hash: null,
      sha: '',
      size,
      index: 0,
      mime: 'image/png',
      extension: 'png',
      fileName: `${id}.png`,
      filePath: `/captures/${id}.png`,
      metadata: null,
      status: '001',
      deviceID: null,
      archivedAt: null,
      createdAt: capturedAt,
      updatedAt: capturedAt
    },
    kind: 'image',
    meta: {
      source: 'capture',
      captureKind: 'screenshot',
      state: 'done',
      isManaged: true,
      keep: false,
      ...extras
    },
    capturedAt,
    src: ''
  }
}

describe('findPruneHints', function () {
  const policies = {
    screenshot: { days: 7, count: 2, maxBytes: 100 },
    recording: { days: 30, count: 50, maxBytes: 5 * 1024 * 1024 * 1024 }
  }

  it('marks overdue by days', function () {
    const now = 1_000_000_000_000
    const items = [
      makeMedia('fresh', now, 1),
      makeMedia('old', now - 10 * 86_400_000, 1)
    ]
    const hints = findPruneHints(items, policies, now)
    expect(hints.get('old')?.willPrune).toBe(true)
    expect(hints.get('old')?.reason).toBe('days')
    expect(hints.get('fresh')?.willPrune).toBe(false)
  })

  it('marks overflow by count', function () {
    const now = 1_000
    const items = [
      makeMedia('a', 300, 1),
      makeMedia('b', 200, 1),
      makeMedia('c', 100, 1)
    ]
    const hints = findPruneHints(items, policies, now)
    expect(hints.get('a')?.willPrune).toBe(false)
    expect(hints.get('b')?.willPrune).toBe(false)
    expect(hints.get('c')?.willPrune).toBe(true)
    expect(hints.get('c')?.reason).toBe('count')
  })

  it('skips keep', function () {
    const now = 1_000
    const items = [makeMedia('a', 0, 999, { keep: true })]
    const hints = findPruneHints(items, { ...policies, screenshot: { days: 0, count: 0, maxBytes: 0 } }, now)
    expect(hints.get('a')?.willPrune).toBe(false)
  })
})
