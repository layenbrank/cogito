import { describe, expect, it, vi } from 'vitest'

import { createHoverProbe } from '@/features/capture/hover-probe'
import type { CaptureRegion } from '@/features/capture/region'

const SETTLE_MS = 10
const INTERVAL_MS = 20

function chain(x: number): CaptureRegion[] {
  return [{ x, y: 0, w: 40, h: 20, kind: 'element', hwnd: 'a', z: 0 }]
}

function wait(ms: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

function setup(onProbe?: (x: number, y: number) => CaptureRegion[]) {
  const probe = vi.fn(function (x: number, y: number) {
    return Promise.resolve(onProbe ? onProbe(x, y) : chain(x))
  })
  const onResult = vi.fn()
  const hover = createHoverProbe({
    probe,
    onResult,
    settleMs: SETTLE_MS,
    intervalMs: INTERVAL_MS
  })
  return { probe, onResult, hover }
}

describe('createHoverProbe', () => {
  it('移动中不探测：连续请求只在停住后查一次（用最新坐标）', async function () {
    const { probe, hover } = setup()

    hover.request({ x: 1, y: 1 })
    await wait(2)
    hover.request({ x: 2, y: 2 })
    await wait(2)
    hover.request({ x: 3, y: 3 })

    await wait(SETTLE_MS + 15)

    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith(3, 3)
  })

  it('结果签名不变时不重复回调', async function () {
    const { onResult, hover } = setup(function () {
      return chain(0)
    })

    hover.request({ x: 10, y: 10 })
    await wait(SETTLE_MS + 15)
    hover.request({ x: 12, y: 10 })
    await wait(SETTLE_MS + INTERVAL_MS + 15)

    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('查询期间又移动 → 完成后用最新坐标补查一次', async function () {
    const resolvers: Array<() => void> = []
    const probe = vi.fn(function (x: number) {
      return new Promise<CaptureRegion[]>(function (resolve) {
        resolvers.push(function () {
          resolve(chain(x))
        })
      })
    })
    const hover = createHoverProbe({
      probe,
      onResult: vi.fn(),
      settleMs: SETTLE_MS,
      intervalMs: INTERVAL_MS
    })

    hover.request({ x: 1, y: 1 })
    await wait(SETTLE_MS + 10)
    expect(probe).toHaveBeenCalledTimes(1)

    // 第一次查询还没回来，用户又移动了
    hover.request({ x: 9, y: 9 })
    resolvers[0]?.()
    await wait(INTERVAL_MS + 15)

    expect(probe).toHaveBeenCalledTimes(2)
    expect(probe).toHaveBeenLastCalledWith(9, 9)
    resolvers[1]?.()
  })

  it('两次探测至少间隔 intervalMs', async function () {
    const { probe, hover } = setup()

    hover.request({ x: 1, y: 1 })
    await wait(SETTLE_MS + 2)
    expect(probe).toHaveBeenCalledTimes(1)

    // 立刻再请求：必须等到间隔结束
    hover.request({ x: 2, y: 2 })
    await wait(2)
    expect(probe).toHaveBeenCalledTimes(1)

    await wait(INTERVAL_MS + SETTLE_MS)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('cancel / dispose 后不再探测', async function () {
    const { probe, hover } = setup()

    hover.request({ x: 1, y: 1 })
    hover.cancel()
    await wait(SETTLE_MS + INTERVAL_MS)
    expect(probe).not.toHaveBeenCalled()

    hover.request({ x: 2, y: 2 })
    await wait(SETTLE_MS + 2)
    expect(probe).toHaveBeenCalledTimes(1)

    hover.dispose()
    hover.request({ x: 3, y: 3 })
    await wait(SETTLE_MS + INTERVAL_MS)
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
