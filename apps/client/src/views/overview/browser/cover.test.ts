import { describe, expect, it } from 'vitest'

import { rectsOverlap } from '@/views/overview/browser/cover'

describe('rectsOverlap', function () {
  const page = { x: 240, y: 56, width: 800, height: 600 }

  it('counts a tooltip that hangs into the page', function () {
    expect(rectsOverlap(page, { x: 900, y: 40, width: 80, height: 32 })).toBe(true)
  })

  it('ignores a tooltip that stays inside the toolbar', function () {
    expect(rectsOverlap(page, { x: 900, y: 8, width: 72, height: 28 })).toBe(false)
  })
})
