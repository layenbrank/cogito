import { describe, expect, it } from 'vitest'

import { findOverlaps, parseSchedulePlan, toWrites } from '@/features/agent/schedule-plan'

function plan(events: unknown[]): string {
  return `日程如下：\n\n\`\`\`json\n${JSON.stringify({ events })}\n\`\`\``
}

describe('日程计划解析', function () {
  it('解析带偏移的 ISO，保留标题与备注', function () {
    const rows = parseSchedulePlan(
      plan([
        {
          title: '写周报',
          notes: '含本周进展',
          startISO: '2026-10-27T09:00:00+08:00',
          endISO: '2026-10-27T10:00:00+08:00',
          entireDay: false,
          color: '#3B82F6'
        }
      ])
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('写周报')
    expect(rows[0].notes).toBe('含本周进展')
    expect(rows[0].endAt).toBeGreaterThan(rows[0].startAt)
    expect(rows[0].color).toBe('#3B82F6')
  })

  it('全天事件结束时间落到次日 00:00 之前 1ms', function () {
    const rows = parseSchedulePlan(
      plan([{ title: '休息', startISO: '2026-10-27T00:00:00+08:00', entireDay: true }])
    )
    expect(rows).toHaveLength(1)
    const start = new Date(rows[0].startAt)
    expect(start.getHours()).toBe(0)
    expect(rows[0].endAt).toBe(rows[0].startAt + 24 * 60 * 60 * 1000 - 1)
  })

  it('日期非法或结束早于开始的行被丢掉', function () {
    const rows = parseSchedulePlan(
      plan([
        { title: '坏日期', startISO: '不是时间', endISO: '2026-10-27T10:00:00+08:00' },
        {
          title: '倒序',
          startISO: '2026-10-27T12:00:00+08:00',
          endISO: '2026-10-27T11:00:00+08:00'
        },
        {
          title: '正常',
          startISO: '2026-10-27T12:00:00+08:00',
          endISO: '2026-10-27T13:00:00+08:00'
        }
      ])
    )
    expect(rows.map(function (row) {
      return row.title
    })).toEqual(['正常'])
  })

  it('没有 events 的 JSON 不产出任何行', function () {
    expect(parseSchedulePlan('```json\n{"foo":1}\n```')).toEqual([])
    expect(parseSchedulePlan('没有 JSON')).toEqual([])
  })

  it('重量提示只报一次标题', function () {
    const rows = parseSchedulePlan(
      plan([
        {
          title: '会议',
          startISO: '2026-10-27T09:00:00+08:00',
          endISO: '2026-10-27T10:00:00+08:00'
        }
      ])
    )
    const conflicts = findOverlaps(rows, [
      { id: 'e1', title: '已有会议', startAt: rows[0].startAt + 60000, endAt: rows[0].endAt }
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('会议')
  })

  it('toWrites 丢掉界面专用字段', function () {
    const rows = parseSchedulePlan(
      plan([
        {
          title: '跑步',
          startISO: '2026-10-27T07:00:00+08:00',
          endISO: '2026-10-27T08:00:00+08:00'
        }
      ])
    )
    const writes = toWrites(rows)
    expect(writes[0]).toMatchObject({ title: '跑步', entireDay: false })
    expect('startISO' in writes[0]).toBe(false)
  })
})
