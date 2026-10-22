import { describe, expect, it } from 'vitest'

import { isOverviewPath } from '@/features/magnetic-tile/overview-path'

describe('isOverviewPath', function () {
  it('matches overview and root', function () {
    expect(isOverviewPath('/overview')).toBe(true)
    expect(isOverviewPath('/')).toBe(true)
  })

  it('rejects app routes', function () {
    expect(isOverviewPath('/gallery')).toBe(false)
    expect(isOverviewPath('/agent/chat')).toBe(false)
    expect(isOverviewPath('/overview/extra')).toBe(false)
  })
})
