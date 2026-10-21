import { describe, expect, it } from 'vitest'

import { canApplyWindowEffects } from '@/features/window/appearance'

describe('canApplyWindowEffects', function () {
  it('rejects overlay so screenshot conceal stays truly transparent', function () {
    expect(canApplyWindowEffects('overlay')).toBe(false)
  })

  it('allows main and feature windows to keep mica', function () {
    expect(canApplyWindowEffects('main')).toBe(true)
    expect(canApplyWindowEffects('settings')).toBe(true)
  })
})
