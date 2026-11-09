import { describe, expect, it } from 'vitest'

import {
  buildSchedule,
  describeConfig,
  parseSchedule,
  sortWeekdays,
  switchScheduleKind
} from '@/features/automation/schedule-config'

describe('buildSchedule', function () {
  it('把可视化选择拼成 5 段 crontab', function () {
    expect(buildSchedule({ kind: 'daily', hour: 9, minute: 0 })).toBe('0 9 * * *')
    expect(buildSchedule({ kind: 'weekly', hour: 18, minute: 30, weekdays: [1, 3, 5] })).toBe(
      '30 18 * * 1,3,5'
    )
    expect(buildSchedule({ kind: 'monthly', hour: 7, minute: 15, day: 1 })).toBe('15 7 1 * *')
    // 最后一天不是某个数字：交给 cron 的 `L`
    expect(buildSchedule({ kind: 'monthly', hour: 9, minute: 0, day: 'last' })).toBe('0 9 L * *')
    expect(buildSchedule({ kind: 'hourly', minute: 0 })).toBe('0 * * * *')
    expect(buildSchedule({ kind: 'interval', minutes: 30 })).toBe('*/30 * * * *')
    expect(buildSchedule({ kind: 'custom', expression: '0 9 * * 1-5' })).toBe('0 9 * * 1-5')
  })

  it('周字段按周一到周日排序，且空选回落到周一', function () {
    expect(buildSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [0, 1] })).toBe(
      '0 9 * * 1,0'
    )
    expect(buildSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [] })).toBe('0 9 * * 1')
  })

  it('「工作日 / 周末」压成短表达式', function () {
    expect(buildSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5] })).toBe(
      '0 9 * * 1-5'
    )
    expect(buildSchedule({ kind: 'weekly', hour: 9, minute: 0, weekdays: [6, 0] })).toBe(
      '0 9 * * 6,0'
    )
  })
})

describe('parseSchedule', function () {
  it('能还原可视化面板支持的形状', function () {
    expect(parseSchedule('0 9 * * *')).toEqual({ kind: 'daily', hour: 9, minute: 0 })
    expect(parseSchedule('30 18 * * 1,3,5')).toEqual({
      kind: 'weekly',
      hour: 18,
      minute: 30,
      weekdays: [1, 3, 5]
    })
    expect(parseSchedule('15 7 1 * *')).toEqual({
      kind: 'monthly',
      hour: 7,
      minute: 15,
      day: 1
    })
    expect(parseSchedule('0 9 L * *')).toEqual({
      kind: 'monthly',
      hour: 9,
      minute: 0,
      day: 'last'
    })
    expect(parseSchedule('0 * * * *')).toEqual({ kind: 'hourly', minute: 0 })
    expect(parseSchedule('*/15 * * * *')).toEqual({ kind: 'interval', minutes: 15 })
  })

  it('周字段的区间写法也能还原成勾选态', function () {
    expect(parseSchedule('0 9 * * 1-5')).toEqual({
      kind: 'weekly',
      hour: 9,
      minute: 0,
      weekdays: [1, 2, 3, 4, 5]
    })
    expect(parseSchedule('0 9 * * 6,0')).toEqual({
      kind: 'weekly',
      hour: 9,
      minute: 0,
      weekdays: [6, 0]
    })
    // 反向区间没有意义，别硬猜
    expect(parseSchedule('0 9 * * 5-1')).toEqual({ kind: 'custom', expression: '0 9 * * 5-1' })
  })

  it('认不出来的一律落 custom，表达式原样保留', function () {
    expect(parseSchedule('0 9 1 3 *')).toEqual({ kind: 'custom', expression: '0 9 1 3 *' })
    expect(parseSchedule('0 9 L 3 *')).toEqual({ kind: 'custom', expression: '0 9 L 3 *' })
    expect(parseSchedule('0 9 * * MON')).toEqual({ kind: 'custom', expression: '0 9 * * MON' })
    expect(parseSchedule('0 9 * * 1-5/2')).toEqual({ kind: 'custom', expression: '0 9 * * 1-5/2' })
    expect(parseSchedule('0 0 9 * * *')).toEqual({
      kind: 'custom',
      expression: '0 0 9 * * *'
    })
    expect(parseSchedule('每分钟')).toEqual({ kind: 'custom', expression: '每分钟' })
  })

  it('解析与拼装互逆（面板打开老任务不跳变）', function () {
    const expressions = [
      '0 9 * * *',
      '30 18 * * 1,5',
      '0 9 * * 1-5',
      '15 7 1 * *',
      '0 9 L * *',
      '0 * * * *',
      '*/10 * * * *'
    ]
    for (const expression of expressions) {
      expect(buildSchedule(parseSchedule(expression))).toBe(expression)
    }
  })
})

describe('switchScheduleKind', function () {
  it('切换频率时保留已选的时间', function () {
    const daily = parseSchedule('30 18 * * *')
    expect(switchScheduleKind(daily, 'weekly')).toEqual({
      kind: 'weekly',
      hour: 18,
      minute: 30,
      weekdays: [1]
    })
    expect(switchScheduleKind(daily, 'monthly')).toEqual({
      kind: 'monthly',
      hour: 18,
      minute: 30,
      day: 1
    })
  })

  it('停在「每月」上不丢「最后一天」', function () {
    const last = parseSchedule('0 9 L * *')
    expect(switchScheduleKind(last, 'monthly')).toEqual({
      kind: 'monthly',
      hour: 9,
      minute: 0,
      day: 'last'
    })
    // 切走再切回按默认 1 号：中间那一步已经不在「每月」上了，不猜
    expect(switchScheduleKind(switchScheduleKind(last, 'daily'), 'monthly')).toEqual({
      kind: 'monthly',
      hour: 9,
      minute: 0,
      day: 1
    })
  })

  it('切到自定义时把当前表达式填进去', function () {
    expect(switchScheduleKind(parseSchedule('0 9 * * 1,2'), 'custom')).toEqual({
      kind: 'custom',
      expression: '0 9 * * 1,2'
    })
  })

  it('从自定义切回可视化时给默认值', function () {
    expect(switchScheduleKind(parseSchedule('0 9 1 3 *'), 'daily')).toEqual({
      kind: 'daily',
      hour: 9,
      minute: 0
    })
  })
})

describe('sortWeekdays', function () {
  it('按周一到周日去重排序，忽略未知值', function () {
    expect(sortWeekdays([0, 3, 1, 3, 9])).toEqual([1, 3, 0])
  })
})

describe('describeConfig', function () {
  it('给出一句人话，界面不必自己拼文案', function () {
    expect(describeConfig({ kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 5] })).toBe(
      '每周一、周五 09:00'
    )
  })

  it('「每月最后一天」也说得出口', function () {
    expect(describeConfig({ kind: 'monthly', hour: 9, minute: 0, day: 'last' })).toBe(
      '每月最后一天 09:00'
    )
  })
})
