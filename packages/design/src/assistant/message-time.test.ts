import { describe, expect, it } from 'vitest'

import { findMessageMoment, formatMessageTime, toDateTimeAttr } from './message-time'

describe('formatMessageTime', () => {
  it('年月日时分秒，月 / 日 / 时 / 分 / 秒都补零', () => {
    expect(formatMessageTime(new Date(2026, 0, 6, 9, 5, 3))).toBe('2026-01-06 09:05:03')
  })

  it('两位数值不截断，也不加多余分隔符', () => {
    expect(formatMessageTime(new Date(2026, 10, 26, 23, 59, 59))).toBe('2026-11-26 23:59:59')
  })

  it('时间戳与 Date 得到同一个结果', () => {
    const stamp = new Date(2026, 10, 6, 10, 36, 0).getTime()
    expect(formatMessageTime(stamp)).toBe('2026-11-06 10:36:00')
  })

  it('缺失或非法值给空串，调用方据此不渲染', () => {
    expect(formatMessageTime(undefined)).toBe('')
    expect(formatMessageTime(null)).toBe('')
    expect(formatMessageTime(Number.NaN)).toBe('')
  })
})

describe('toDateTimeAttr', () => {
  it('给 <time datetime> 用 T 分隔、不带时区偏移', () => {
    expect(toDateTimeAttr(new Date(2026, 10, 6, 10, 36, 0))).toBe('2026-11-06T10:36:00')
  })

  it('非法值给 undefined（React 会直接不写这个属性）', () => {
    expect(toDateTimeAttr(undefined)).toBeUndefined()
  })
})

describe('findMessageMoment', () => {
  const createdAt = new Date(2026, 10, 6, 10, 34, 48).getTime()

  it('结束时刻 = 起点 + 流式总时长', () => {
    expect(findMessageMoment(createdAt, 72_000)).toBe(createdAt + 72_000)
    expect(formatMessageTime(findMessageMoment(createdAt, 72_000))).toBe('2026-11-06 10:36:00')
  })

  it('没有时长（失败 / 秒回）退回起点', () => {
    expect(findMessageMoment(createdAt)).toBe(createdAt)
    expect(findMessageMoment(createdAt, 0)).toBe(createdAt)
    expect(findMessageMoment(createdAt, Number.NaN)).toBe(createdAt)
  })

  it('连起点都没有就给 undefined', () => {
    expect(findMessageMoment(undefined, 72_000)).toBeUndefined()
    expect(findMessageMoment(Number.NaN, 72_000)).toBeUndefined()
  })
})
