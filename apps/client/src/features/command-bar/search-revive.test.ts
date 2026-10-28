import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openUrlMock } = vi.hoisted(function () {
  return {
    openUrlMock: vi.fn(function () {
      return Promise.resolve()
    })
  }
})

vi.mock('@tauri-apps/plugin-opener', function () {
  return {
    openUrl: openUrlMock
  }
})

vi.mock('@/features/command-bar/registry', function () {
  return {
    searchLocalProviders: function () {
      return []
    }
  }
})

vi.mock('@/features/command-bar/providers/web', function () {
  return {
    findInstantWebHits: function () {
      return []
    }
  }
})

vi.mock('@/features/command-bar/store', function () {
  return {
    readEngineKey: function () {
      return 'bing'
    },
    readRecentHits: function () {
      return []
    }
  }
})

describe('reviveRecentHit', function () {
  beforeEach(function () {
    openUrlMock.mockClear()
  })

  it('web 建议无法精确复活时，退回当前引擎搜索标题', async function () {
    const { reviveRecentHit } = await import('@/features/command-bar/search')
    await reviveRecentHit({
      domain: 'web',
      id: 'suggest:rust:0',
      title: 'rust lang'
    })
    expect(openUrlMock).toHaveBeenCalledWith(
      'https://cn.bing.com/search?q=rust%20lang'
    )
  })

  it('非 web 且无法复活时留痕且不打开链接', async function () {
    const warn = vi.spyOn(console, 'warn').mockImplementation(function () {})
    const { reviveRecentHit } = await import('@/features/command-bar/search')
    await reviveRecentHit({
      domain: 'tile',
      id: 'missing',
      title: 'gone'
    })
    expect(openUrlMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
