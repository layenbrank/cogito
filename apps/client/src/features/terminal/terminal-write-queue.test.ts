/**
 * 写入队列的行为断言。
 *
 * 这里测的是「顺序 / 合并 / 串行」三件事 —— 它们错了的表现是终端画面错乱，
 * 在 GUI 里很难复现，只能靠单元测试钉住。
 */
import { describe, expect, it } from 'vitest'

import { createWriteQueue, MAX_FLUSH_BYTES } from './terminal-write-queue'

interface FakeTerminal {
  writes: number[][]
  /** 每次 write 对应的「解析完成」回调，由用例决定何时调用 */
  callbacks: Array<() => void>
  write: (bytes: Uint8Array, callback?: () => void) => void
}

function fakeTerminal(): FakeTerminal {
  const term: FakeTerminal = {
    writes: [],
    callbacks: [],
    write: function (bytes: Uint8Array, callback?: () => void) {
      term.writes.push(Array.from(bytes))
      if (callback) term.callbacks.push(callback)
    }
  }
  return term
}

/** 手动推进的帧：`runFrame()` 执行一次已排的 rAF 回调 */
function frameRunner() {
  const frames: Array<() => void> = []
  return {
    frames,
    schedule: (callback: () => void) => {
      frames.push(callback)
      return frames.length - 1
    },
    cancel: () => {
      // 取消语义在本用例里只需「不再执行」，frames 清空即可
      frames.length = 0
    },
    runFrame: function () {
      const next = frames.shift()
      next?.()
    }
  }
}

describe('createWriteQueue', function () {
  it('同一帧内的多次 push 合并成一次 write，字节顺序不变', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(Uint8Array.from([1, 2]))
    queue.push(Uint8Array.from([3]))
    queue.push(Uint8Array.from([4, 5]))

    expect(term.writes).toHaveLength(0)
    frame.runFrame()

    expect(term.writes).toEqual([[1, 2, 3, 4, 5]])
  })

  it('串行：上一块没回调前不会写下一块', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(Uint8Array.from([1]))
    frame.runFrame()
    expect(term.writes).toEqual([[1]])

    // 第一块还在解析（回调未调用），新块只能等
    queue.push(Uint8Array.from([2]))
    frame.runFrame()
    expect(term.writes).toEqual([[1]])

    // 解析完成 → 下一帧把积压的块写出去
    term.callbacks.shift()?.()
    frame.runFrame()
    expect(term.writes).toEqual([[1], [2]])
  })

  it('pushText 与 push 共用同一条队列，文本按 UTF-8 编码', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.pushText('中')
    queue.push(Uint8Array.from([0x0a]))
    frame.runFrame()

    expect(term.writes).toHaveLength(1)
    // "中" = e4 b8 ad
    expect(term.writes[0]).toEqual([0xe4, 0xb8, 0xad, 0x0a])
  })

  it('积压超过上限时立即写，不等下一帧', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(new Uint8Array(MAX_FLUSH_BYTES))

    expect(term.writes).toHaveLength(1)
    expect(term.writes[0]).toHaveLength(MAX_FLUSH_BYTES)
    expect(queue.pendingBytes()).toBe(0)
  })

  it('跨帧切开的 UTF-8 字符原样保留：队列只搬字节，解码交给 xterm 的有状态解码器', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    // "中" = e4 b8 ad，被 PTY 切成两次读
    queue.push(Uint8Array.from([0xe4, 0xb8]))
    frame.runFrame()
    term.callbacks.shift()?.()
    queue.push(Uint8Array.from([0xad]))
    frame.runFrame()

    expect(term.writes).toEqual([
      [0xe4, 0xb8],
      [0xad]
    ])
    // 拼起来仍是完整的 "中"；如果队列在 chunk 边界上解码，这里会出现 U+FFFD
    const merged = Uint8Array.from(term.writes.flat())
    const decoded = new TextDecoder().decode(merged)
    expect(decoded).toBe('中')
    expect(decoded.includes('\uFFFD')).toBe(false)
  })

  it('pendingBytes 反映尚未写出的字节数', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(Uint8Array.from([1, 2, 3]))
    expect(queue.pendingBytes()).toBe(3)

    frame.runFrame()
    expect(queue.pendingBytes()).toBe(0)
  })

  it('flushNow 不等帧，立即写出（并取消已排的帧）', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(Uint8Array.from([9]))
    queue.flushNow()

    expect(term.writes).toEqual([[9]])
    expect(frame.frames).toHaveLength(0)
  })

  it('dispose 后丢弃剩余字节，不再写', function () {
    const term = fakeTerminal()
    const frame = frameRunner()
    const queue = createWriteQueue(term, { schedule: frame.schedule, cancel: frame.cancel })

    queue.push(Uint8Array.from([1]))
    queue.dispose()
    queue.push(Uint8Array.from([2]))
    frame.runFrame()

    expect(term.writes).toHaveLength(0)
    expect(queue.pendingBytes()).toBe(0)
  })

  /**
   * 压测口径：10 万行（含中文）灌进队列，一个字节都不能少，但 `write` 次数必须远少于
   * chunk 数 —— 这正是「长输出不卡、不错乱」的来源：合并成少数几次串行写入，
   * 而不是 10 万次 `term.write` 把解析器切碎。
   */
  it('10 万行压测：字节不丢，写入次数被合并压到百以内', function () {
    let writes = 0
    let bytes = 0
    const light = {
      write: function (chunk: Uint8Array, callback?: () => void) {
        writes += 1
        bytes += chunk.byteLength
        callback?.()
      }
    }
    const queue = createWriteQueue(light, {
      schedule: function () {
        return 0
      },
      cancel: function () {}
    })

    const chunk = new TextEncoder().encode('line-000000\t中文字段\r\n')
    const lines = 100_000
    for (let index = 0; index < lines; index += 1) queue.push(chunk)
    queue.flushNow()

    expect(bytes).toBe(chunk.byteLength * lines)
    expect(writes).toBeLessThan(100)
    expect(queue.pendingBytes()).toBe(0)
  })
})
