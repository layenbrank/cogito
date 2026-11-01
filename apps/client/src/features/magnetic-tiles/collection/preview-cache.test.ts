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
      {
        index: 0,
        mark: 'https://cdn.simpleicons.org/github/ffffff',
        title: 'GitHub',
        url: 'https://github.com',
        background: { color: '#24292F' },
        textColor: 'F8FAFC'
      }
    ])

    const cache = await import(
      '@/features/magnetic-tiles/collection/preview-cache'
    )
    await cache.fetchCollectionMarkerPreviews('c1', 1)
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toEqual([
      {
        src: 'https://cdn.simpleicons.org/github/ffffff',
        label: 'G',
        surface: '#24292F',
        ink: '#F8FAFC'
      }
    ])

    vi.mocked(invoke).mockResolvedValue([
      {
        index: 0,
        mark: 'https://www.google.com/s2/favicons?domain=yuque.com&sz=256',
        title: '语雀',
        url: 'https://www.yuque.com',
        background: { color: '#FFFFFF' },
        textColor: '0F172A'
      }
    ])
    await cache.fetchCollectionMarkerPreviews('c1', 2)
    expect(cache.readCollectionMarkerPreviews('c1', 2)).toEqual([
      {
        src: 'https://www.google.com/s2/favicons?domain=yuque.com&sz=256',
        label: '语',
        surface: '#FFFFFF',
        ink: '#0F172A'
      }
    ])
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toBeUndefined()
  })

  it('invalidate clears keyed entries', async function () {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue([
      {
        index: 0,
        mark: 'A',
        title: 'Alpha',
        url: null,
        background: { color: '#DBEAFE' },
        textColor: '1E40AF'
      }
    ])

    const cache = await import(
      '@/features/magnetic-tiles/collection/preview-cache'
    )
    await cache.fetchCollectionMarkerPreviews('c1', 1)
    cache.invalidateCollectionMarkerPreviews('c1')
    expect(cache.readCollectionMarkerPreviews('c1', 1)).toBeUndefined()
  })
})
