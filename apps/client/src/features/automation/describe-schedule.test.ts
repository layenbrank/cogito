import { describe, expect, it } from 'vitest'

import { describeSchedule } from '@/features/automation/describe-schedule'

describe('describeSchedule', function () {
  it('认识「每天 / 每周 / 每月」', function () {
    expect(describeSchedule('0 9 * * *')).toBe('每天 09:00')
    expect(describeSchedule('30 18 * * *')).toBe('每天 18:30')
    expect(describeSchedule('0 9 * * 1')).toBe('每周一 09:00')
    expect(describeSchedule('0 8 * * 0')).toBe('每周日 08:00')
    expect(describeSchedule('15 7 1 * *')).toBe('每月 1 号 07:15')
  })

  it('认识间隔写法', function () {
    expect(describeSchedule('*/15 * * * *')).toBe('每 15 分钟')
    expect(describeSchedule('0 */6 * * *')).toBe('每 6 小时')
  })

  it('不认识的形状原样返回（猜错比不猜更糟）', function () {
    expect(describeSchedule('0 9 1 3 *')).toBe('0 9 1 3 *')
    expect(describeSchedule('0 9 * *')).toBe('0 9 * *')
    expect(describeSchedule('0 9 * * * 2027')).toBe('0 9 * * * 2027')
    expect(describeSchedule('每分钟')).toBe('每分钟')
  })
})
