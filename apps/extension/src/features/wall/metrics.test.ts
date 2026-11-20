import { describe, expect, it } from 'vitest'

import { findTileBox, findTrackPx } from './metrics.ts'

describe('findTrackPx', function () {
  it('一格就是单元边长', function () {
    expect(findTrackPx(1)).toBe(60)
  })

  it('跨格把间距算进去', function () {
    expect(findTrackPx(2)).toBe(150)
    expect(findTrackPx(4)).toBe(330)
  })
})

describe('findTileBox', function () {
  it('方形按短边成正方形', function () {
    expect(findTileBox({ size: 2, shape: 'square', direction: 'horizontal' })).toEqual({
      columns: 2,
      rows: 2,
      width: 150,
      height: 150
    })
  })

  it('横向矩形长边翻倍', function () {
    expect(findTileBox({ size: 2, shape: 'rectangle', direction: 'horizontal' })).toEqual({
      columns: 4,
      rows: 2,
      width: 330,
      height: 150
    })
  })
})
