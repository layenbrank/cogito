import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(function () {
  return { invoke: vi.fn() }
})

vi.mock('@tauri-apps/api/core', function () {
  return {
    convertFileSrc: function (path: string) {
      return path
    },
    invoke: ipc.invoke
  }
})

import { CHANNELS } from '@/shared/ipc/channels'

import { takePendingScreenshot } from './tauri'

const SHOT = { path: 'shot.png', width: 1920, height: 1080, scale_factor: 1 }

describe('takePendingScreenshot', function () {
  beforeEach(function () {
    ipc.invoke.mockReset()
    vi.useFakeTimers()
  })

  afterEach(function () {
    vi.useRealTimers()
  })

  it('第一次就取到时不重试', async function () {
    ipc.invoke.mockResolvedValueOnce(SHOT)

    await expect(takePendingScreenshot()).resolves.toEqual(SHOT)
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
    expect(ipc.invoke).toHaveBeenCalledWith(CHANNELS.CAPTURE.TAKE_PENDING)
  })

  /** pending 是宿主在切截屏态之前发布的，理论上首取必中；这里覆盖极端时序 */
  it('pending 晚到时会重试到取到为止', async function () {
    ipc.invoke
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(SHOT)

    const pending = takePendingScreenshot()
    await vi.advanceTimersByTimeAsync(200)

    await expect(pending).resolves.toEqual(SHOT)
    expect(ipc.invoke).toHaveBeenCalledTimes(3)
  })

  it('预算用尽仍为空则返回 null', async function () {
    ipc.invoke.mockResolvedValue(null)

    const pending = takePendingScreenshot()
    await vi.advanceTimersByTimeAsync(1000)

    await expect(pending).resolves.toBeNull()
    expect(ipc.invoke).toHaveBeenCalledTimes(5)
  })

  it('已取消的实例不再发新的 take，避免抢走新一帧', async function () {
    ipc.invoke.mockResolvedValue(null)
    let stopped = false

    const pending = takePendingScreenshot(function () {
      return stopped
    })
    stopped = true
    await vi.advanceTimersByTimeAsync(1000)

    await expect(pending).resolves.toBeNull()
    expect(ipc.invoke).toHaveBeenCalledTimes(1)
  })
})
