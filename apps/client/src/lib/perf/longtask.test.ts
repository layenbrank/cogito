import { describe, expect, it } from 'vitest'

import {
  MAX_LONG_TASK_RECORDS,
  SLOW_TASK_MS,
  createSnapshot,
  summarizeLongTasks
} from './longtask'

describe('summarizeLongTasks', function () {
  it('没有历史时以 now 作为 since，并累计总数', function () {
    const next = summarizeLongTasks([{ startTime: 10, duration: 60 }, { startTime: 20, duration: 200 }], null, {
      now: 1000
    })
    expect(next.since).toBe(1000)
    expect(next.total).toBe(2)
    expect(next.slow).toBe(1)
    expect(next.maxDuration).toBe(200)
    expect(next.records).toHaveLength(2)
    expect(next.records[1]).toEqual({ startTime: 20, duration: 200, at: 1000 })
  })

  it('阈值为 120ms 时 119ms 不计入 slow', function () {
    expect(SLOW_TASK_MS).toBe(120)
    const next = summarizeLongTasks([{ startTime: 0, duration: 119 }], null, { now: 1 })
    expect(next.total).toBe(1)
    expect(next.slow).toBe(0)
  })

  it('并入上一份快照：total / slow / max 累加，since 不变', function () {
    const first = summarizeLongTasks([{ startTime: 1, duration: 300 }], null, { now: 100 })
    const second = summarizeLongTasks([{ startTime: 2, duration: 130 }], first, { now: 200 })
    expect(second.since).toBe(first.since)
    expect(second.total).toBe(2)
    expect(second.slow).toBe(2)
    expect(second.maxDuration).toBe(300)
    expect(second.records.map(function (record) { return record.at })).toEqual([100, 200])
  })

  it('记录只保留最近 keep 条，但 total 照常累加', function () {
    const entries = Array.from({ length: 5 }, function (_, index) {
      return { startTime: index, duration: 200 }
    })
    const next = summarizeLongTasks(entries, null, { now: 1, keep: 3 })
    expect(next.total).toBe(5)
    expect(next.records).toHaveLength(3)
    expect(next.records.map(function (record) { return record.startTime })).toEqual([2, 3, 4])
  })

  it('空批次不改变已有快照的数值', function () {
    const base = summarizeLongTasks([{ startTime: 1, duration: 250 }], null, { now: 50 })
    const same = summarizeLongTasks([], base, { now: 60 })
    expect(same.total).toBe(base.total)
    expect(same.slow).toBe(base.slow)
    expect(same.maxDuration).toBe(base.maxDuration)
    expect(same.records).toEqual(base.records)
  })

  it('非法 duration 按 0 处理，不会污染 maxDuration', function () {
    const next = summarizeLongTasks(
      [
        { startTime: 0, duration: Number.NaN },
        { startTime: 1, duration: Number.POSITIVE_INFINITY }
      ],
      null,
      { now: 1 }
    )
    expect(next.maxDuration).toBe(0)
    expect(next.slow).toBe(0)
    expect(next.records.every(function (record) { return Number.isFinite(record.duration) })).toBe(true)
  })

  it('默认保留条数是 50', function () {
    expect(MAX_LONG_TASK_RECORDS).toBe(50)
    const entries = Array.from({ length: 60 }, function (_, index) {
      return { startTime: index, duration: 10 }
    })
    const next = summarizeLongTasks(entries, null, { now: 1 })
    expect(next.records).toHaveLength(MAX_LONG_TASK_RECORDS)
  })

  it('createSnapshot 给的是空账本', function () {
    expect(createSnapshot(7)).toEqual({ since: 7, total: 0, slow: 0, maxDuration: 0, records: [] })
  })
})
