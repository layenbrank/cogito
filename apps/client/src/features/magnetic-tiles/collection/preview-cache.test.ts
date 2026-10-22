import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return {
    invoke: vi.fn()
  }
})

vi.mock('@/shared/ipc/channels', function () {
  return {
    CHANNELS: {
      MAGNETIC_TILE: { READ: 'magnetic_tile:read' }
    }
  }
})

describe('collection preview-cache', function () {
  beforeEach(async function () {
    vi.resetModules()
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockReset()
  })

  it('evicts older revision keys for the same collection', async function () {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue([
      { index: 0, mark: 'A', title: 'Alpha' }
    ])

    const cache = await import(
      '@/features/magnetic-tiles/collection/preview-cache'
    )
    await cache.fetchCollectionMarkerPreviews('c1', 1)
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toEqual(['A'])

    vi.mocked(invoke).mockResolvedValue([
      { index: 0, mark: 'B', title: 'Beta' }
    ])
    await cache.fetchCollectionMarkerPreviews('c1', 2)
    expect(cache.readCollectionMarkerPreviews('c1', 2)).toEqual(['B'])
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toBeUndefined()
  })

  it('invalidate clears keyed entries', async function () {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue([
      { index: 0, mark: 'A', title: 'Alpha' }
    ])

    const cache = await import(
      '@/features/magnetic-tiles/collection/preview-cache'
    )
    await cache.fetchCollectionMarkerPreviews('c1', 1)
    cache.invalidateCollectionMarkerPreviews('c1')
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toBeUndefined()
  })
})
