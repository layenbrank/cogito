import { describe, expect, it } from 'vitest'

import { FALLBACK_MAX_TOKENS, pickContextWindow } from './context-window'

describe('pickContextWindow', function () {
  it('有会话统计又以它为准（统计 200k、偏好没设 → 200k）', function () {
    expect(pickContextWindow(200_000, 0)).toEqual({ tokens: 200_000, source: 'stats' })
  })

  it('偏好调高才覆盖：goose 目录写 128k、用户选 1M → 用 1M', function () {
    expect(pickContextWindow(128_000, 1_000_000)).toEqual({
      tokens: 1_000_000,
      source: 'preference'
    })
  })

  it('偏好调低不覆盖：统计 1M、偏好还是默认 128k → 仍是 1M', function () {
    expect(pickContextWindow(1_000_000, 128_000)).toEqual({
      tokens: 1_000_000,
      source: 'stats'
    })
  })

  it('没有统计时用偏好；两者都没有才落到 128k', function () {
    expect(pickContextWindow(0, 400_000)).toEqual({ tokens: 400_000, source: 'preference' })
    expect(pickContextWindow(0, 0)).toEqual({ tokens: FALLBACK_MAX_TOKENS, source: 'fallback' })
  })

  it('坏值按「没有」处理，不当成 0 或 NaN 传下去', function () {
    expect(pickContextWindow(Number.NaN, -1)).toEqual({
      tokens: FALLBACK_MAX_TOKENS,
      source: 'fallback'
    })
  })
})
