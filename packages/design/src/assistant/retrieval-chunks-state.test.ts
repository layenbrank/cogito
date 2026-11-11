import { describe, expect, it } from 'vitest'

import { clampScore, formatScore, toPercent } from './retrieval-chunks-state'

describe('clampScore', function () {
  it('越界值钳进 0..1', function () {
    expect(clampScore(-0.3)).toBe(0)
    expect(clampScore(1.4)).toBe(1)
    expect(clampScore(0.62)).toBeCloseTo(0.62)
  })

  it('NaN 当 0、±Infinity 钳到两端：条不会画出负数或超宽', function () {
    expect(clampScore(Number.NaN)).toBe(0)
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampScore(Number.NEGATIVE_INFINITY)).toBe(0)
  })
})

describe('toPercent', function () {
  it('四舍五入到整数百分比', function () {
    expect(toPercent(0.908)).toBe(91)
    expect(toPercent(0.844)).toBe(84)
    expect(toPercent(0.615)).toBe(62)
    expect(toPercent(0)).toBe(0)
  })

  it('与 aria-valuenow 同源：越界也落在 0..100', function () {
    expect(toPercent(-1)).toBe(0)
    expect(toPercent(2)).toBe(100)
  })
})

describe('formatScore', function () {
  it('两位小数，跟条宽读同一个值', function () {
    expect(formatScore(0.908)).toBe('0.91')
    expect(formatScore(1)).toBe('1.00')
    expect(formatScore(Number.NaN)).toBe('0.00')
  })
})
