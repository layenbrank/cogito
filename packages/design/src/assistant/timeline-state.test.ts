import { describe, expect, it } from 'vitest'

import { clampVisibleCount, toTimelineWhen } from './timeline-state'

describe('clampVisibleCount', function () {
  it('向下取整后钳进 0…total', function () {
    expect(clampVisibleCount(2.9, 4)).toBe(2)
    expect(clampVisibleCount(0, 4)).toBe(0)
    expect(clampVisibleCount(4, 4)).toBe(4)
    expect(clampVisibleCount(99, 4)).toBe(4)
  })

  it('负数 / NaN 当 0，总数非法当空：一条都不画，但不崩', function () {
    expect(clampVisibleCount(-3, 4)).toBe(0)
    expect(clampVisibleCount(Number.NaN, 4)).toBe(0)
    expect(clampVisibleCount(2, Number.NaN)).toBe(0)
  })
})

describe('toTimelineWhen', function () {
  it('结束时刻已过 → past，还没开始 → future，其余 → now', function () {
    const now = 1_000
    expect(toTimelineWhen(100, 900, now)).toBe('past')
    expect(toTimelineWhen(1_100, 1_200, now)).toBe('future')
    expect(toTimelineWhen(900, 1_100, now)).toBe('now')
  })

  it('正好卡在两端算正在进行的那一场', function () {
    expect(toTimelineWhen(900, 1_000, 1_000)).toBe('now')
    expect(toTimelineWhen(1_000, 1_100, 1_000)).toBe('now')
  })

  it('区间非法（NaN）退成 now：至少还能显示', function () {
    expect(toTimelineWhen(Number.NaN, Number.NaN, 1_000)).toBe('now')
  })
})
