import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface ThroughPayload {
  source: string
  rects: { x: number; y: number; w: number; h: number }[]
}

const { invokeMock } = vi.hoisted(function () {
  return {
    invokeMock: vi.fn(function (_command: string, _params: ThroughPayload) {
      return Promise.resolve(undefined)
    })
  }
})

vi.mock('@tauri-apps/api/core', function () {
  return { invoke: invokeMock }
})

import {
  FLUSH_DELAY_MS,
  attachThroughSource,
  detachThroughSource,
  diffThroughPayload,
  rectsKey,
  resetThroughCollector,
  scheduleFlush
} from './use-through'

const A = { x: 0, y: 10, w: 100, h: 20 }
const B = { x: 0, y: 40, w: 100, h: 20 }

function makeHit(top = 0): HTMLDivElement {
  const el = document.createElement('div')
  el.setAttribute('data-region', 'false')
  el.getBoundingClientRect = function () {
    return {
      left: 0,
      top,
      width: 100,
      height: 20,
      right: 100,
      bottom: top + 20,
      x: 0,
      y: top,
      toJSON: function () {
        return {}
      }
    }
  }
  document.body.appendChild(el)
  return el
}

describe('diffThroughPayload', function () {
  it('首次登记全部算变化', function () {
    const history = new Map<string, string>()
    const next = new Map([['tile-1', [A]], ['skipbar', [B]]])
    expect(diffThroughPayload(history, next).map(function (item) { return item.source })).toEqual([
      'tile-1',
      'skipbar'
    ])
  })

  it('rects 完全一致就不重复上报 IPC', function () {
    const history = new Map([['tile-1', rectsKey([A])]])
    const next = new Map([['tile-1', [A]]])
    expect(diffThroughPayload(history, next)).toEqual([])
  })

  it('位置变化要上报', function () {
    const history = new Map([['tile-1', rectsKey([A])]])
    const next = new Map([['tile-1', [B]]])
    expect(diffThroughPayload(history, next)).toHaveLength(1)
  })

  it('清空（停用来源）会作为一次变化上报空数组', function () {
    const history = new Map([['tile-1', rectsKey([A])]])
    const next = new Map<string, { x: number; y: number; w: number; h: number }[]>([['tile-1', []]])
    const changed = diffThroughPayload(history, next)
    expect(changed).toHaveLength(1)
    expect(changed[0]?.rects).toEqual([])
  })

  it('一次 flush 覆盖多个来源，互不影响', function () {
    const history = new Map([
      ['tile-1', rectsKey([A])],
      ['skipbar', rectsKey([B])]
    ])
    const next = new Map([
      ['tile-1', [A]],
      ['skipbar', []]
    ])
    expect(diffThroughPayload(history, next).map(function (item) { return item.source })).toEqual([
      'skipbar'
    ])
  })

  it('合并窗口是 200ms', function () {
    expect(FLUSH_DELAY_MS).toBe(200)
  })
})

describe('单例收集器（假定时器 + mock invoke）', function () {
  beforeEach(function () {
    vi.useFakeTimers()
    invokeMock.mockClear()
    resetThroughCollector()
  })

  afterEach(function () {
    resetThroughCollector()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('一帧内几十次触发只发 1 次 IPC', function () {
    const el = makeHit(0)
    attachThroughSource('tile', el)

    for (let index = 0; index < 20; index += 1) scheduleFlush()

    expect(invokeMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)

    expect(invokeMock).toHaveBeenCalledTimes(1)
    const payload = invokeMock.mock.calls[0][1]
    expect(payload.source).toBe('tile')
    expect(payload.rects).toEqual([{ x: 0, y: 0, w: 100, h: 20 }])
  })

  it('几何没变就不再上报', function () {
    const el = makeHit(0)
    attachThroughSource('tile', el)
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(invokeMock).toHaveBeenCalledTimes(1)

    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('3 秒内持续抖动：IPC 次数 ≤ 15（每 200ms 最多一次）', function () {
    const el = makeHit(0)
    attachThroughSource('tile', el)

    let step = 0
    for (let elapsed = 0; elapsed < 3000; elapsed += 16) {
      step += 1
      el.getBoundingClientRect = function () {
        return {
          left: 0,
          top: step,
          width: 100,
          height: 20,
          right: 100,
          bottom: step + 20,
          x: 0,
          y: step,
          toJSON: function () {
            return {}
          }
        }
      }
      scheduleFlush()
      vi.advanceTimersByTime(16)
    }

    const calls = invokeMock.mock.calls.length
    expect(calls).toBeLessThanOrEqual(15)
    expect(calls).toBeGreaterThanOrEqual(10)
  })

  it('停用来源会补发一次空数组，之后不再有流量', function () {
    const el = makeHit(0)
    attachThroughSource('tile', el)
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(invokeMock).toHaveBeenCalledTimes(1)

    detachThroughSource('tile')
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)

    expect(invokeMock).toHaveBeenCalledTimes(2)
    const payload = invokeMock.mock.calls[1][1]
    expect(payload.rects).toEqual([])

    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('卸载（isConnected=false）的根节点按停用处理', function () {
    const el = makeHit(0)
    attachThroughSource('tile', el)
    el.remove()
    scheduleFlush()
    vi.advanceTimersByTime(FLUSH_DELAY_MS)

    const payload = invokeMock.mock.calls[0][1]
    expect(payload.rects).toEqual([])
  })
})
