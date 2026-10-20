import { describe, expect, it } from 'vitest'

import { findWindowLabel } from '@/features/window/kind'

describe('findWindowLabel', function () {
  it('returns empty string outside Tauri', function () {
    expect(findWindowLabel()).toBe('')
  })
})
