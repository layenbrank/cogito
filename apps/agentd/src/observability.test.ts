/**
 * 可观测性：计数器只增不减、日志一行一条 JSON。
 *
 * 这里只断言「形状」而不去盯具体数字：数字的价值在于跑起来之后能对上，
 * 而形状错了会让诊断的人（和 grep 的脚本）直接失效。
 */

import { describe, expect, it, vi } from 'vitest'

import { METRIC_NAMES, createMetrics, createObservability } from './observability'

describe('计数器', function () {
  it('所有指标初始为 0 且名字已登记', function () {
    const metrics = createMetrics()
    const snapshot = metrics.snapshot()
    expect(Object.keys(snapshot.counters).sort()).toEqual([...METRIC_NAMES].sort())
    for (const name of METRIC_NAMES) {
      expect(snapshot.counters[name]).toBe(0)
    }
  })

  it('inc 支持累加与步长；snapshot 记录最后一次观测时间', function () {
    const metrics = createMetrics()
    metrics.inc('runs.started')
    metrics.inc('runs.started')
    metrics.inc('events.cursor.replays', 3)
    const snapshot = metrics.snapshot()
    expect(snapshot.counters['runs.started']).toBe(2)
    expect(snapshot.counters['events.cursor.replays']).toBe(3)
    expect(typeof snapshot.lastAt['runs.started']).toBe('number')
    // 没被 inc 过的指标不该有 lastAt，否则「最后一次是多久前」会误导
    expect(snapshot.lastAt['runs.failed']).toBeUndefined()
  })

  it('snapshot 是拷贝：之后 inc 不会改已取出的对象', function () {
    const metrics = createMetrics()
    const before = metrics.snapshot()
    metrics.inc('runs.started')
    expect(before.counters['runs.started']).toBe(0)
    expect(metrics.snapshot().counters['runs.started']).toBe(1)
  })
})

describe('结构化日志', function () {
  it('一行一条 JSON，带 event / at 与平铺字段', function () {
    const spy = vi.spyOn(console, 'log').mockImplementation(function () {})
    try {
      const observability = createObservability()
      observability.event('run.settled', {
        threadID: 't1',
        runID: 'r1',
        status: 'success',
        durationMs: 42
      })
      expect(spy).toHaveBeenCalledTimes(1)
      const line = String(spy.mock.calls[0][0])
      expect(line.startsWith('AGENTD_EVENT ')).toBe(true)
      const payload = JSON.parse(line.slice('AGENTD_EVENT '.length)) as Record<string, unknown>
      expect(payload.event).toBe('run.settled')
      expect(typeof payload.at).toBe('string')
      // 字段必须平铺（不做嵌套），这样 jq / Select-String 都直接可用
      expect(payload.threadID).toBe('t1')
      expect(payload.runID).toBe('r1')
      expect(payload.durationMs).toBe(42)
      expect(payload).not.toHaveProperty('fields')
    } finally {
      spy.mockRestore()
    }
  })
})
