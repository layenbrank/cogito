import { describe, expect, it } from 'vitest'

import { hasWallEntered, markWallEntered } from '@/features/magnetic-tile/enter'

describe('wall enter gate', function () {
  it('tracks per mirror id', function () {
    const id = `mirror-enter-test-${Date.now()}`
    expect(hasWallEntered(id)).toBe(false)
    markWallEntered(id)
    expect(hasWallEntered(id)).toBe(true)
    expect(hasWallEntered(null)).toBe(false)
  })
})
