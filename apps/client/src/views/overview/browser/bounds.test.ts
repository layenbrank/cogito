import { describe, expect, it } from 'vitest'

import {
  SIDEBAR_OPEN,
  SIDEBAR_SHUT,
  TOOLBAR,
  findTargetBounds
} from '@/views/overview/browser/bounds'

describe('findTargetBounds', function () {
  it('places the page to the right of the open sidebar and below the toolbar', function () {
    expect(findTargetBounds(1200, 800, SIDEBAR_OPEN)).toEqual({
      x: SIDEBAR_OPEN,
      y: TOOLBAR,
      width: 1200 - SIDEBAR_OPEN,
      height: 800 - TOOLBAR
    })
  })

  it('grows the page when the sidebar shuts', function () {
    const open = findTargetBounds(1200, 800, SIDEBAR_OPEN)
    const shut = findTargetBounds(1200, 800, SIDEBAR_SHUT)
    expect(shut.x).toBe(SIDEBAR_SHUT)
    expect(shut.width).toBeGreaterThan(open.width)
  })

  it('never returns a negative size', function () {
    expect(findTargetBounds(40, 20, SIDEBAR_OPEN).width).toBe(0)
    expect(findTargetBounds(40, 20, SIDEBAR_OPEN).height).toBe(0)
  })
})
