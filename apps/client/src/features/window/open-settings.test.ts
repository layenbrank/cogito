import { beforeEach, describe, expect, it, vi } from 'vitest'

const openComponentRouteMock = vi.fn(function () {
  return Promise.resolve()
})

vi.mock('@/features/command-bar/open-route', function () {
  return {
    openComponentRoute: openComponentRouteMock
  }
})

describe('openSettings', function () {
  beforeEach(function () {
    openComponentRouteMock.mockClear()
  })

  it('默认进账号分区，并带上 settings 会话路径', async function () {
    const { openSettings, findSettingsPath } = await import('@/features/window/open-settings')
    expect(findSettingsPath()).toBe('/settings?section=account')
    await openSettings()
    expect(openComponentRouteMock).toHaveBeenCalledWith('settings', {
      path: '/settings?section=account'
    })
  })

  it('可指定外观分区', async function () {
    const { openSettings, findSettingsPath } = await import('@/features/window/open-settings')
    expect(findSettingsPath('appearance')).toBe('/settings?section=appearance')
    await openSettings('appearance')
    expect(openComponentRouteMock).toHaveBeenCalledWith('settings', {
      path: '/settings?section=appearance'
    })
  })
})
