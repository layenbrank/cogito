import { describe, expect, it } from 'vitest'

import { formatTimelineLabel, resolveVisibleSteps } from './tool-timeline-state'

const LABELS = {
  timelineSteps: (count: number) => `${count} 步`,
  filesChanged: (count: number) => `${count} 个文件改动`
}

describe('resolveVisibleSteps', function () {
  it('不传 = 全出', function () {
    expect(resolveVisibleSteps(undefined, 4)).toBe(4)
  })

  it('向下取整：0.9 步不算露出一步', function () {
    expect(resolveVisibleSteps(2.9, 4)).toBe(2)
    expect(resolveVisibleSteps(0.9, 4)).toBe(0)
  })

  it('钳进 0…total（步骤可以先于展示存在）', function () {
    expect(resolveVisibleSteps(99, 4)).toBe(4)
    expect(resolveVisibleSteps(-3, 4)).toBe(0)
    expect(resolveVisibleSteps(3, 0)).toBe(0)
  })

  it('NaN 当成一步都不露', function () {
    expect(resolveVisibleSteps(Number.NaN, 4)).toBe(0)
  })
})

describe('formatTimelineLabel', function () {
  it('步数 + 文件改动', function () {
    expect(formatTimelineLabel(4, 2, LABELS)).toBe('4 步 · 2 个文件改动')
  })

  it('没有文件改动就只写步数（不写「0 个文件改动」）', function () {
    expect(formatTimelineLabel(3, 0, LABELS)).toBe('3 步')
  })
})
