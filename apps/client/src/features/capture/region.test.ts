import { describe, expect, it } from 'vitest'

import {
  buildRegionIndex,
  findHoverStack,
  hasRealCandidate,
  stepGroup,
  stepLevel,
  type CaptureRegion
} from '@/features/capture/region'

const SCREEN = { w: 1920, h: 1080 }

function region(patch: Partial<CaptureRegion>): CaptureRegion {
  return { x: 0, y: 0, w: 100, h: 100, kind: 'frame', hwnd: 'a', z: 0, ...patch }
}

describe('findHoverStack', () => {
  it('元素链排在最前（最细）', function () {
    const elements = [region({ kind: 'element', w: 40, h: 20 })]
    const regions = [
      region({ kind: 'client', w: 800, h: 600 }),
      region({ kind: 'frame', w: 820, h: 640 })
    ]

    const stack = findHoverStack(buildRegionIndex(regions), elements, 10, 10, SCREEN)

    expect(stack.levels[0]?.kind).toBe('element')
    expect(stack.levels[1]?.kind).toBe('client')
    expect(stack.levels[2]?.kind).toBe('frame')
    expect(stack.levels[stack.levels.length - 1]?.kind).toBe('screen')
  })

  it('同窗口内子控件按面积升序，客户区先于窗口框', function () {
    const regions = [
      region({ kind: 'frame', w: 900, h: 700 }),
      region({ kind: 'child', w: 500, h: 400, control_type: '面板' }),
      region({ kind: 'child', w: 80, h: 30, control_type: '按钮' }),
      region({ kind: 'client', w: 890, h: 660 })
    ]

    const kinds = findHoverStack(buildRegionIndex(regions), [], 10, 10, SCREEN).levels.map(
      function (item) {
        return item.w
      }
    )

    expect(kinds.slice(0, 4)).toEqual([80, 500, 890, 900])
  })

  it('多窗口按 z 序分组，组首下标对得上', function () {
    const regions = [
      region({ hwnd: 'back', z: 3, kind: 'frame', w: 800, h: 600 }),
      region({ hwnd: 'front', z: 1, kind: 'frame', w: 400, h: 300 }),
      region({ hwnd: 'front', z: 1, kind: 'client', w: 390, h: 260 })
    ]

    const stack = findHoverStack(buildRegionIndex(regions), [], 10, 10, SCREEN)

    expect(stack.levels.map(function (item) {
      return item.hwnd
    })).toEqual(['front', 'front', 'back', undefined])
    expect(stack.groupStarts).toEqual([0, 2, 3])
  })

  it('光标处没有窗口时只剩整屏，且不算有效候选', function () {
    const stack = findHoverStack(buildRegionIndex([]), [], 500, 500, SCREEN)

    expect(stack.levels).toHaveLength(1)
    expect(hasRealCandidate(stack)).toBe(false)
  })

  it('不在光标下的候选被过滤掉', function () {
    const regions = [region({ x: 1000, y: 1000, w: 200, h: 200 })]
    const stack = findHoverStack(buildRegionIndex(regions), [], 10, 10, SCREEN)

    expect(stack.levels).toHaveLength(1)
  })
})

describe('stepLevel / stepGroup', () => {
  const regions = [
    region({ hwnd: 'front', z: 1, kind: 'client' }),
    region({ hwnd: 'front', z: 1, kind: 'frame', w: 200, h: 200 }),
    region({ hwnd: 'back', z: 2, kind: 'client', w: 300, h: 300 }),
    region({ hwnd: 'back', z: 2, kind: 'frame', w: 320, h: 320 })
  ]
  const stack = findHoverStack(buildRegionIndex(regions), [], 10, 10, SCREEN)

  it('逐层移动且循环', function () {
    expect(stepLevel(stack, 0, 1)).toBe(1)
    expect(stepLevel(stack, 0, -1)).toBe(stack.levels.length - 1)
  })

  it('同层跳组时落到目标组的最细一层', function () {
    expect(stepGroup(stack, 0, 1)).toBe(stack.groupStarts[1])
    expect(stepGroup(stack, stack.groupStarts[1] ?? 0, -1)).toBe(0)
  })
})
