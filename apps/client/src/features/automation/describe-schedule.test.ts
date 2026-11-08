import { describe, expect, it } from 'vitest'

import { describeSchedule, isValidSchedule } from '@/features/automation/describe-schedule'

describe('describeSchedule', function () {
  it('认识「每天 / 每周 / 每月」', function () {
    expect(describeSchedule('0 9 * * *')).toBe('每天 09:00')
    expect(describeSchedule('30 18 * * *')).toBe('每天 18:30')
    expect(describeSchedule('0 9 * * 1')).toBe('每周一 09:00')
    expect(describeSchedule('0 8 * * 0')).toBe('每周日 08:00')
    expect(describeSchedule('15 7 1 * *')).toBe('每月 1 号 07:15')
  })

  it('认识「每周多天」与「工作日」', function () {
    expect(describeSchedule('0 9 * * 1,3,5')).toBe('每周一、周三、周五 09:00')
    expect(describeSchedule('30 18 * * 0,6')).toBe('每周日、周六 18:30')
    expect(describeSchedule('0 9 * * 1-5')).toBe('工作日 09:00')
  })

  it('认识「每月最后一天」', function () {
    // 2 月 28/29、4 月 30 日……不是某个固定数字，所以单列一种说法
    expect(describeSchedule('0 9 L * *')).toBe('每月最后一天 09:00')
    expect(describeSchedule('30 18 L * *')).toBe('每月最后一天 18:30')
    // 同时限定星期 / 月份的形状认不出来，原样返回
    expect(describeSchedule('0 9 L * 1')).toBe('0 9 L * 1')
    expect(describeSchedule('0 9 L 3 *')).toBe('0 9 L 3 *')
  })

  it('认识间隔写法', function () {
    expect(describeSchedule('*/15 * * * *')).toBe('每 15 分钟')
    expect(describeSchedule('0 */6 * * *')).toBe('每 6 小时')
  })

  it('认识「每小时第 N 分」', function () {
    expect(describeSchedule('0 * * * *')).toBe('每小时整点')
    expect(describeSchedule('30 * * * *')).toBe('每小时第 30 分')
  })

  it('不认识的形状原样返回（猜错比不猜更糟）', function () {
    expect(describeSchedule('0 9 1 3 *')).toBe('0 9 1 3 *')
    expect(describeSchedule('0 9 * *')).toBe('0 9 * *')
    expect(describeSchedule('0 9 * * * 2027')).toBe('0 9 * * * 2027')
    expect(describeSchedule('每分钟')).toBe('每分钟')
  })
})

describe('isValidSchedule', function () {
  it('接受 5 段与 6–7 段（Rust 侧 5 段补秒、6–7 段直传）', function () {
    expect(isValidSchedule('0 9 * * *')).toBe(true)
    expect(isValidSchedule('*/30 * * * *')).toBe(true)
    expect(isValidSchedule('0 9 * * 1-5')).toBe(true)
    expect(isValidSchedule('0 0 9 * * *')).toBe(true)
    // `L` = 当月最后一天，字符集里本来就留着它
    expect(isValidSchedule('0 9 L * *')).toBe(true)
  })

  it('拦明显打错的表达式', function () {
    expect(isValidSchedule('')).toBe(false)
    expect(isValidSchedule('0 9 * *')).toBe(false)
    expect(isValidSchedule('每天 9 点')).toBe(false)
    expect(isValidSchedule('0 9 * * 1 2 3 4')).toBe(false)
  })
})
