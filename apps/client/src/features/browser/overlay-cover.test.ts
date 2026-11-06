/**
 * 浮层让位判定：显式标记优先，hit-test 兜底。
 *
 * 这里的用例锁的是「历史列表被页面盖住」那类回归：只要有一个 HTML 图层真的画在
 * 占位区上面（不管它有没有打 `data-webview="false"`），判定就必须返回它。
 */
import { describe, expect, it, vi } from 'vitest'

import { findCoveringOverlay, hasCoverMarker, samplePoints } from './overlay-cover'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** jsdom 里所有 rect 都是 0，需要自己钉一个 */
function withRect<T extends Element>(element: T, box: Box): T {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: function () {
      return { ...box, right: box.left + box.width, bottom: box.top + box.height }
    }
  })
  return element
}

const SURFACE_BOX: Box = { left: 0, top: 100, width: 400, height: 300 }

function mountSurface(box: Box = SURFACE_BOX) {
  document.body.innerHTML = ''
  const host = document.createElement('div')
  const surface = document.createElement('div')
  surface.setAttribute('data-browser-surface', '')
  host.appendChild(surface)
  document.body.appendChild(host)
  withRect(surface, box)
  return { host, surface }
}

function markedLayer(box: Box, parent: Element = document.body) {
  const layer = document.createElement('ul')
  layer.setAttribute('data-webview', 'false')
  withRect(layer, box)
  parent.appendChild(layer)
  return layer
}

describe('findCoveringOverlay', function () {
  it('显式标记的浮层与占位区相交 → 判定为遮挡', function () {
    const { surface } = mountSurface()
    const layer = markedLayer({ left: 10, top: 150, width: 200, height: 120 })

    expect(findCoveringOverlay(surface, { hitTest: () => [] })).toBe(layer)
  })

  it('标记了但没压到占位区 → 不算遮挡', function () {
    const { surface } = mountSurface()
    markedLayer({ left: 10, top: 10, width: 200, height: 60 })

    expect(findCoveringOverlay(surface, { hitTest: () => [] })).toBeNull()
  })

  it('标记了但点击穿透（pointer-events: none）→ 不算遮挡', function () {
    const { surface } = mountSurface()
    const layer = markedLayer({ left: 10, top: 150, width: 200, height: 120 })
    layer.style.pointerEvents = 'none'

    expect(findCoveringOverlay(surface, { hitTest: () => [] })).toBeNull()
  })

  it('没打标记的手写浮层：hit-test 能认出来（历史列表就漏过这一步）', function () {
    const { surface } = mountSurface()
    const list = document.createElement('ul')
    document.body.appendChild(list)

    const hitTest = function () {
      return [list, document.body]
    }
    expect(findCoveringOverlay(surface, { hitTest })).toBe(list)
  })

  it('命中链只有占位区自己 / 它的子节点 → 不算遮挡', function () {
    const { surface } = mountSurface()
    const pauseLayer = document.createElement('div')
    surface.appendChild(pauseLayer)

    const hitTest = function () {
      return [pauseLayer, surface, document.body]
    }
    expect(findCoveringOverlay(surface, { hitTest })).toBeNull()
  })

  it('走到占位区祖先就停：说明占位区已经是画面最上层', function () {
    const { host, surface } = mountSurface()

    const hitTest = function () {
      return [host, document.body]
    }
    expect(findCoveringOverlay(surface, { hitTest })).toBeNull()
  })

  it('穿透图层被跳过，后面的祖先照常收尾', function () {
    const { surface } = mountSurface()
    const ghost = document.createElement('div')
    ghost.style.pointerEvents = 'none'
    document.body.appendChild(ghost)

    const hitTest = function () {
      return [ghost, document.body]
    }
    expect(findCoveringOverlay(surface, { hitTest })).toBeNull()
  })

  it('占位区尺寸为 0（未布局 / 未挂载）时不做 hit-test', function () {
    const { surface } = mountSurface({ left: 0, top: 0, width: 0, height: 0 })
    const hitTest = vi.fn(function () {
      return []
    })

    expect(findCoveringOverlay(surface, { hitTest })).toBeNull()
    expect(hitTest).not.toHaveBeenCalled()
  })
})

describe('hasCoverMarker', function () {
  it('元素本身或祖先带 data-webview="false" 都算打了标记', function () {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-webview', 'false')
    const child = document.createElement('span')
    wrapper.appendChild(child)
    document.body.appendChild(wrapper)

    expect(hasCoverMarker(child)).toBe(true)
  })

  it('未标记的浮层返回 false（开发态会提示补标记）', function () {
    const list = document.createElement('ul')
    document.body.appendChild(list)

    expect(hasCoverMarker(list)).toBe(false)
  })
})

describe('samplePoints', function () {
  it('够大就采 3×3，全部落在占位区内缩后的范围内', function () {
    const points = samplePoints({ left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300 })

    expect(points).toHaveLength(9)
    for (const point of points) {
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(400)
      expect(point.y).toBeGreaterThan(0)
      expect(point.y).toBeLessThan(300)
    }
  })

  it('很窄的占位区退化成中心点', function () {
    const points = samplePoints({ left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20 })

    expect(points).toEqual([{ x: 10, y: 10 }])
  })
})
