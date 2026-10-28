import { describe, expect, it } from 'vitest'

import { flattenColor, formatColor, mixColor, withAlpha } from './css-color.ts'

/** Monaco 的 token 颜色只认 `#RRGGBB` / `#RRGGBBAA`，其它写法会直接抛错 */
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/

describe('formatColor', function () {
  it('输出 6 位 hex', function () {
    expect(formatColor({ r: 9, g: 11, b: 12, a: 1 })).toBe('#090b0c')
    expect(formatColor({ r: 9, g: 11, b: 12, a: 1 })).toMatch(HEX)
  })

  it('带透明度时输出 8 位 hex', function () {
    expect(formatColor({ r: 255, g: 255, b: 255, a: 0 })).toBe('#ffffff00')
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 })).toMatch(HEX)
  })
})

describe('颜色派生', function () {
  it('withAlpha 保持 hex 格式', function () {
    expect(withAlpha('#7c3aed', 0.5)).toMatch(HEX)
  })

  it('flattenColor 输出不透明实色', function () {
    expect(flattenColor('#ffffff1a', '#000000')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('mixColor 输出 hex', function () {
    expect(mixColor('#000000', '#ffffff', 0.5)).toMatch(HEX)
  })
})
