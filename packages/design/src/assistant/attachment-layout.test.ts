import { describe, expect, it } from 'vitest'

import {
  clampPan,
  containSize,
  findAttachmentTileSize,
  fitViewport,
  zoomAtCenter,
  zoomAtPointer
} from './attachment-layout'

describe('containSize', () => {
  it('宽图按宽度贴合，高度按比例缩', function () {
    expect(containSize({ width: 400, height: 300 }, { width: 1600, height: 400 })).toEqual({
      width: 400,
      height: 100
    })
  })

  it('竖图按高度贴合，宽度按比例缩', function () {
    expect(containSize({ width: 400, height: 300 }, { width: 300, height: 900 })).toEqual({
      width: 100,
      height: 300
    })
  })

  it('外框或内容无尺寸时给 0，不产生 NaN', function () {
    expect(containSize({ width: 0, height: 0 }, { width: 10, height: 10 })).toEqual({
      width: 0,
      height: 0
    })
  })
})

describe('findAttachmentTileSize', () => {
  it('高度固定，宽度跟着比例走', function () {
    expect(
      findAttachmentTileSize({ width: 1600, height: 900 }, { height: 56, maxWidth: 168 })
    ).toEqual({ width: 100, height: 56 })
  })

  it('超宽图钳到 maxWidth，不再拉长', function () {
    expect(
      findAttachmentTileSize({ width: 4000, height: 500 }, { height: 56, maxWidth: 168 })
    ).toEqual({ width: 168, height: 56 })
  })

  it('极端竖图钳到 minWidth，缩略图不会压成一条缝', function () {
    expect(
      findAttachmentTileSize(
        { width: 200, height: 1600 },
        { height: 56, maxWidth: 168, minWidth: 32 }
      )
    ).toEqual({ width: 32, height: 56 })
  })

  it('默认不低于高度：竖图不会比原先的方块更窄', function () {
    expect(
      findAttachmentTileSize({ width: 900, height: 1600 }, { height: 56, maxWidth: 168 })
    ).toEqual({ width: 56, height: 56 })
  })

  it('还没解码出尺寸时给正方形占位', function () {
    expect(findAttachmentTileSize(null, { height: 96, maxWidth: 288 })).toEqual({
      width: 96,
      height: 96
    })
  })
})

describe('fitViewport', () => {
  it('100% 时 contain 居中', function () {
    expect(fitViewport({ width: 400, height: 300 }, { width: 1600, height: 400 })).toEqual({
      scale: 1,
      x: 0,
      y: 100
    })
  })
})

describe('zoomAtPointer', () => {
  const bounds = { width: 400, height: 300 }
  const content = { width: 1600, height: 400 }

  it('指针下的那一点在缩放前后停在原地', function () {
    const view = fitViewport(bounds, content)
    const pointer = { x: 120, y: 180 }
    const zoomed = zoomAtPointer(view, pointer, 2)
    const before = {
      x: (pointer.x - view.x) / view.scale,
      y: (pointer.y - view.y) / view.scale
    }
    const after = {
      x: (pointer.x - zoomed.x) / zoomed.scale,
      y: (pointer.y - zoomed.y) / zoomed.scale
    }
    expect(zoomed.scale).toBe(2)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('缩到 100% 就停住，不会比 contain 还小', function () {
    const view = fitViewport(bounds, content)
    expect(zoomAtPointer(view, { x: 0, y: 0 }, 0.5).scale).toBe(1)
  })

  it('放大到上限就停住', function () {
    const view = fitViewport(bounds, content)
    let next = view
    for (let index = 0; index < 40; index += 1) {
      next = zoomAtPointer(next, { x: 200, y: 150 }, 2)
    }
    expect(next.scale).toBe(8)
  })
})

describe('zoomAtCenter', () => {
  it('以视口中心为锚', function () {
    const bounds = { width: 400, height: 300 }
    const view = fitViewport(bounds, { width: 400, height: 300 })
    const zoomed = zoomAtCenter(view, bounds, 2)
    expect(zoomed.scale).toBe(2)
    expect(zoomed.x).toBe(-200)
    expect(zoomed.y).toBe(-150)
  })
})

describe('clampPan', () => {
  const bounds = { width: 400, height: 300 }
  const content = { width: 1600, height: 400 }

  it('没有超出外框时居中，位移被忽略', function () {
    const centered = clampPan({ scale: 1, x: 999, y: -999 }, bounds, content)
    expect(centered).toEqual({ scale: 1, x: 0, y: 100 })
  })

  it('放大后不允许把图拖出外框', function () {
    const view = zoomAtCenter(fitViewport(bounds, content), bounds, 2)
    expect(clampPan({ scale: view.scale, x: 500, y: 500 }, bounds, content)).toEqual({
      scale: 2,
      x: 0,
      // 放大后仍然比外框矮：竖直方向继续居中
      y: 50
    })
    expect(clampPan({ scale: view.scale, x: -5000, y: -5000 }, bounds, content)).toEqual({
      scale: 2,
      x: 400 - 800,
      y: 50
    })
  })
})
