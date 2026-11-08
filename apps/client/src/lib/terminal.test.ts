/**
 * `lib/terminal.ts` 的有序流断言。
 *
 * 关键 bug：`Channel` 在构造时就绑定了 onmessage，Rust 读线程可能先于 `invoke`
 * 返回推来实时块；而 `replay` 是 invoke 的返回值。按到达顺序写 → 同一段内容
 * 在 xterm 里出现两遍（先实时、后回放）。这里用假 Channel + 假 invoke 把时序钉住。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(function () {
  return { invokeMock: vi.fn() }
})

vi.mock('@tauri-apps/api/core', function () {
  class FakeChannel<T> {
    onmessage: (data: T) => void
    constructor(onmessage: (data: T) => void) {
      this.onmessage = onmessage
    }
  }
  return { Channel: FakeChannel, invoke: invokeMock }
})

import { Terminal } from './terminal'

type ChannelLike = { onmessage: (data: ArrayBuffer) => void }
type InvokeArgs = { channel: ChannelLike; id?: string; cwd?: string }

function bytesOf(value: Uint8Array): number[] {
  return Array.from(value)
}

beforeEach(function () {
  invokeMock.mockReset()
})

describe('Terminal.attach：回放与实时块的顺序', function () {
  it('先写 replay，再按到达顺序补上早到的实时块', async function () {
    invokeMock.mockImplementation(function (_cmd: string, args: InvokeArgs) {
      // invoke 还没返回：实时块已经到了
      args.channel.onmessage(new Uint8Array([3]).buffer)
      args.channel.onmessage(new Uint8Array([4]).buffer)
      return Promise.resolve({ id: 'agent:a', pid: 11, replay: [1, 2] })
    })

    const seen: number[] = []
    const created = await Terminal.attach('agent:a', function (data) {
      seen.push(...bytesOf(data))
    })

    expect(seen).toEqual([1, 2, 3, 4])
    expect(created.pid).toBe(11)
  })

  it('没有 replay 时按到达顺序原样写', async function () {
    invokeMock.mockImplementation(function (_cmd: string, args: InvokeArgs) {
      args.channel.onmessage(new Uint8Array([7]).buffer)
      return Promise.resolve({ id: 'x', pid: null, replay: undefined })
    })

    const seen: number[] = []
    await Terminal.attach('x', function (data) {
      seen.push(...bytesOf(data))
    })

    expect(seen).toEqual([7])
  })

  it('settle 之后的实时块直接透传，不再缓冲', async function () {
    let channelRef: ChannelLike | null = null
    invokeMock.mockImplementation(function (_cmd: string, args: InvokeArgs) {
      channelRef = args.channel
      return Promise.resolve({ id: 'x', pid: 1, replay: [] })
    })

    const seen: number[] = []
    await Terminal.attach('x', function (data) {
      seen.push(...bytesOf(data))
    })

    const channel = channelRef as ChannelLike | null
    channel?.onmessage(new Uint8Array([9]).buffer)
    expect(seen).toEqual([9])
  })

  it('attach 失败时放行已收到的块，并把错误抛给调用方', async function () {
    invokeMock.mockImplementation(function (_cmd: string, args: InvokeArgs) {
      args.channel.onmessage(new Uint8Array([5]).buffer)
      return Promise.reject(new Error('会话不存在'))
    })

    const seen: number[] = []
    await expect(
      Terminal.attach('gone', function (data) {
        seen.push(...bytesOf(data))
      })
    ).rejects.toThrow('会话不存在')
    expect(seen).toEqual([5])
  })
})

describe('Terminal.create：同一套有序语义', function () {
  it('回放包含实时块时不重复', async function () {
    invokeMock.mockImplementation(function (_cmd: string, args: InvokeArgs) {
      args.channel.onmessage(new Uint8Array([2]).buffer)
      return Promise.resolve({ id: 'new', pid: 3, replay: [1] })
    })

    const seen: number[] = []
    await Terminal.create('C:/w', 'new', function (data) {
      seen.push(...bytesOf(data))
    })

    expect(seen).toEqual([1, 2])
  })
})
