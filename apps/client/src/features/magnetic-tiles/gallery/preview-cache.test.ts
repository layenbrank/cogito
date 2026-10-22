import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', function () {
  return {
    convertFileSrc: function (path: string) {
      return `asset:///${path}`
    },
    invoke: vi.fn()
  }
})

vi.mock('@/shared/ipc/channels', function () {
  return {
    CHANNELS: {
      ASSET: { READ: 'asset:read' }
    }
  }
})

vi.mock('@/views/gallery/model/media', function () {
  return {
    filterVisible: function (items: unknown[]) {
      return items
    },
    sortByCapturedAt: function (items: unknown[]) {
      return items
    },
    toGalleryMedia: function (
      asset: { filePath: string },
      src: string
    ) {
      return { src, asset }
    }
  }
})

describe('gallery preview-cache', function () {
  beforeEach(async function () {
    vi.resetModules()
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockReset()
  })

  it('does not write stale result after invalidate', async function () {
    const { invoke } = await import('@tauri-apps/api/core')
    let resolveRead: (value: { filePath: string }[]) => void = function () {}
    vi.mocked(invoke).mockImplementation(function () {
      return new Promise(function (resolve) {
        resolveRead = resolve
      })
    })

    const cache = await import('@/features/magnetic-tiles/gallery/preview-cache')
    const pending = cache.fetchGalleryMarkerThumbs()
    cache.invalidateGalleryMarkerThumbs()
    resolveRead([{ filePath: 'a.jpg' }])
    await pending

    expect(cache.readGalleryMarkerThumbs()).toBeNull()
  })

  it('treats empty array as a cached hit', async function () {
    const { invoke } = await import('@tauri-apps/api/core')
    vi.mocked(invoke).mockResolvedValue([])

    const cache = await import('@/features/magnetic-tiles/gallery/preview-cache')
    const first = await cache.fetchGalleryMarkerThumbs()
    expect(first).toEqual([])
    expect(cache.readGalleryMarkerThumbs()).toEqual([])

    vi.mocked(invoke).mockClear()
    const second = await cache.fetchGalleryMarkerThumbs()
    expect(second).toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
