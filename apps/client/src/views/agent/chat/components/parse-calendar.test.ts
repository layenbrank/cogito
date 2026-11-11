import { describe, expect, it } from 'vitest'

import { parseCalendarEvents, toTimelineEvents } from './parse-tool-result'

const LABELS = {
  timelineAllDay: '全天',
  timelineUntitled: '未命名日程',
  timelineUntil: (clock: string) => '至 ' + clock
}

/** 固定本地时刻：用本地构造，断言里都是「这台机器看到的那一格」 */
function at(hour: number, minute: number): number {
  return new Date(2026, 10, 10, hour, minute, 0, 0).getTime()
}

const RAW = [
  {
    id: 'c1',
    title: '周会',
    startAt: at(9, 0),
    endAt: at(10, 30),
    notes: '会议室 A',
    entireDay: false
  },
  { id: 'c2', title: '午休', startAt: at(12, 0), endAt: at(13, 0) }
]

describe('parseCalendarEvents', function () {
  it('直接数组：开始 / 结束 / 标题 / 备注都认得', function () {
    const events = parseCalendarEvents(RAW)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      id: 'c1',
      title: '周会',
      startAt: at(9, 0),
      endAt: at(10, 30),
      notes: '会议室 A'
    })
  })

  it('包一层 events / data 也能拆出来', function () {
    expect(parseCalendarEvents({ events: RAW })).toHaveLength(2)
    expect(parseCalendarEvents({ data: { items: RAW } })).toHaveLength(2)
  })

  it('编码过的 JSON 字符串先解一层', function () {
    const events = parseCalendarEvents(JSON.stringify({ events: RAW }))
    expect(events[0]?.title).toBe('周会')
  })

  it('没有开始时刻的行整条丢掉：时间轴上没处放', function () {
    const events = parseCalendarEvents([{ title: '无时刻' }, RAW[0]])
    expect(events).toHaveLength(1)
  })

  it('结束时刻缺省 = 开始时刻', function () {
    const events = parseCalendarEvents([{ id: 'c3', title: '打点', startAt: at(8, 0) }])
    expect(events[0]?.endAt).toBe(at(8, 0))
  })
})

describe('toTimelineEvents', function () {
  it('左列开始时刻，说明写「至 10:30」与备注', function () {
    const rows = toTimelineEvents(parseCalendarEvents(RAW), at(9, 15), LABELS)
    expect(rows[0]).toMatchObject({
      time: '09:00',
      title: '周会',
      detail: '至 10:30 · 会议室 A'
    })
  })

  it('when 按当前时刻判定：过去 / 正在 / 将来', function () {
    const rows = toTimelineEvents(parseCalendarEvents(RAW), at(11, 0), LABELS)
    expect(rows[0]?.when).toBe('past')
    expect(rows[1]?.when).toBe('future')
    const during = toTimelineEvents(parseCalendarEvents(RAW), at(9, 30), LABELS)
    expect(during[0]?.when).toBe('now')
  })

  it('全天事件左列写「全天」，说明里不重复时段', function () {
    const rows = toTimelineEvents(
      parseCalendarEvents([{ id: 'c4', title: '国庆', startAt: at(0, 0), entireDay: true }]),
      at(9, 0),
      LABELS
    )
    expect(rows[0]?.time).toBe('全天')
    expect(rows[0]?.detail).toBe('')
  })

  it('没有标题时给兜底名', function () {
    const rows = toTimelineEvents(
      parseCalendarEvents([{ id: 'c5', startAt: at(9, 0) }]),
      at(9, 0),
      LABELS
    )
    expect(rows[0]?.title).toBe('未命名日程')
  })
})
