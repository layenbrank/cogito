import { beforeEach, describe, expect, it } from 'vitest'

import {
  MAX_TRACES,
  formatExplorerTrace,
  readExplorerSnapshot,
  resetExplorerPerf,
  startExplorerOp
} from '@/views/code/workspace/overlay/explorer-perf.ts'

/** 同步调度：把「下一帧」压成立即回调，让单测可断言 */
function scheduleNow(callback: () => void): void {
  callback()
}

describe('explorer-perf', function () {
  beforeEach(function () {
    resetExplorerPerf()
  })

  it('settle 后记录一条，count/read 生效', function () {
    startExplorerOp('fetch', 'node_modules', scheduleNow).count(1200).read(7).settle()
    const snapshot = readExplorerSnapshot()
    expect(snapshot.total).toBe(1)
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0].scope).toBe('fetch')
    expect(snapshot.records[0].relative).toBe('node_modules')
    expect(snapshot.records[0].count).toBe(1200)
    expect(snapshot.records[0].readMs).toBe(7)
    expect(snapshot.records[0].frameMs).toBeGreaterThanOrEqual(0)
  })

  it('settle 幂等：重复调用只记一条', function () {
    const trace = startExplorerOp('refresh', 'src', scheduleNow)
    trace.settle()
    trace.settle()
    expect(readExplorerSnapshot().total).toBe(1)
  })

  it('滚动窗口封顶 MAX_TRACES 条', function () {
    for (let index = 0; index < MAX_TRACES + 5; index += 1) {
      startExplorerOp('refresh', `dir-${index}`, scheduleNow).count(index).settle()
    }
    const snapshot = readExplorerSnapshot()
    expect(snapshot.total).toBe(MAX_TRACES + 5)
    expect(snapshot.records).toHaveLength(MAX_TRACES)
    // 保留的是最近的那批
    expect(snapshot.records[snapshot.records.length - 1].relative).toBe(
      `dir-${MAX_TRACES + 4}`
    )
  })

  it('reset 后计数与最大值归零', function () {
    startExplorerOp('fetch', 'a', scheduleNow).count(1).settle()
    resetExplorerPerf(1000)
    const snapshot = readExplorerSnapshot()
    expect(snapshot.total).toBe(0)
    expect(snapshot.maxFrameMs).toBe(0)
    expect(snapshot.records).toEqual([])
    expect(snapshot.since).toBe(1000)
  })

  it('摘要文本可读，根目录用 (root) 占位', function () {
    startExplorerOp('fetch', '', scheduleNow).count(12).read(2).settle()
    const entry = readExplorerSnapshot().records[0]
    const text = formatExplorerTrace(entry)
    expect(text).toContain('[explorer] fetch (root) 12 项')
    expect(text).toContain('读 2ms')
  })
})
