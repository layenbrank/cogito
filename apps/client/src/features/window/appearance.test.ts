import { describe, expect, it } from 'vitest'

import { canUseWindowEffects } from '@/features/window/appearance'

describe('canUseWindowEffects', function () {
  it('rejects overlay so screenshot conceal stays truly transparent', function () {
    expect(canUseWindowEffects('overlay')).toBe(false)
  })

  it('allows main and feature windows to keep mica', function () {
    expect(canUseWindowEffects('main')).toBe(true)
    expect(canUseWindowEffects('settings')).toBe(true)
  })
})
