import { describe, expect, it } from 'vitest'

import {
  DOCK_VISIBLE_RATIO,
  clampIslandPoint,
  findIslandOrientation,
  findNearestEdge,
  findResultsPlacement,
  fromRatio,
  resolveDockPoint,
  toRatio
} from '@/views/overlay/island/island-geometry.ts'

const viewport = { width: 1920, height: 1080 }
const size = { width: 40, height: 40 }

describe('island geometry', () => {
  it('吸附最近的边，超过阈值就自由漂浮', () => {
    expect(findNearestEdge({ x: 800, y: 10 }, size, viewport)).toBe('top')
    expect(findNearestEdge({ x: 800, y: 1020 }, size, viewport)).toBe('bottom')
    expect(findNearestEdge({ x: 4, y: 500 }, size, viewport)).toBe('left')
    expect(findNearestEdge({ x: 1876, y: 500 }, size, viewport)).toBe('right')
    expect(findNearestEdge({ x: 900, y: 500 }, size, viewport)).toBeNull()
  })

  it('贴边后只露一小截', () => {
    const top = resolveDockPoint('top', { x: 900, y: 2 }, size, viewport)
    expect(top.y).toBe(-Math.round(size.height * (1 - DOCK_VISIBLE_RATIO)))
    const left = resolveDockPoint('left', { x: 2, y: 500 }, size, viewport)
    expect(left.x).toBe(-Math.round(size.width * (1 - DOCK_VISIBLE_RATIO)))
    const bottom = resolveDockPoint('bottom', { x: 900, y: 1030 }, size, viewport)
    expect(bottom.y).toBe(viewport.height - Math.round(size.height * DOCK_VISIBLE_RATIO))
  })

  it('贴边时沿边方向仍被夹在屏内', () => {
    const docked = resolveDockPoint('top', { x: -200, y: 0 }, size, viewport)
    expect(docked.x).toBeGreaterThanOrEqual(0)
    const dockedRight = resolveDockPoint('top', { x: 5000, y: 0 }, size, viewport)
    expect(dockedRight.x).toBeLessThanOrEqual(viewport.width - size.width)
  })

  it('自由态收进屏内', () => {
    expect(clampIslandPoint({ x: -50, y: -50 }, size, viewport)).toEqual({ x: 8, y: 8 })
  })

  it('左右边纵向、上下边横向', () => {
    expect(findIslandOrientation('left')).toBe('vertical')
    expect(findIslandOrientation('right')).toBe('vertical')
    expect(findIslandOrientation('top')).toBe('horizontal')
    expect(findIslandOrientation(null)).toBe('horizontal')
  })

  it('结果面板往空间大的一侧弹', () => {
    expect(findResultsPlacement({ x: 0, y: 20 }, size, viewport)).toBe('below')
    expect(findResultsPlacement({ x: 0, y: 1000 }, size, viewport)).toBe('above')
  })

  it('相对坐标可往返', () => {
    const ratio = toRatio({ x: 960, y: 108 }, viewport)
    expect(ratio.ratioX).toBeCloseTo(0.5)
    expect(ratio.ratioY).toBeCloseTo(0.1)
    const back = fromRatio(ratio.ratioX, ratio.ratioY, viewport)
    expect(Math.round(back.x)).toBe(960)
    expect(Math.round(back.y)).toBe(108)
  })
})
