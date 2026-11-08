/**
 * 可视化时间定义：结构化配置 ⇄ 5 段 crontab（分 时 日 月 周）。
 *
 * 普通用户只在界面上选「每天 / 每周 / 每月 / 每小时 / 每 N 分钟 + 时间」，
 * 保存前由 `buildSchedule` 拼成 crontab；打开已有任务时 `parseSchedule` 反向还原，
 * 认不出来的表达式一律落到 `custom`，原样显示、原样保存（不擅自改写用户的老任务）。
 *
 * 纯函数、无副作用，单测见 `schedule-config.test.ts`。
 */

import { describeSchedule } from './describe-schedule'

type ScheduleKind = 'daily' | 'weekly' | 'monthly' | 'hourly' | 'interval' | 'custom'

interface DailySchedule {
  kind: 'daily'
  hour: number
  minute: number
}

interface WeeklySchedule {
  kind: 'weekly'
  hour: number
  minute: number
  /** cron 周字段：0 = 周日 … 6 = 周六 */
  weekdays: number[]
}

interface MonthlySchedule {
  kind: 'monthly'
  hour: number
  minute: number
  /** 1–31，或 `last`（当月最后一天，cron 记作 L） */
  day: number | 'last'
}

interface HourlySchedule {
  kind: 'hourly'
  minute: number
}

interface IntervalSchedule {
  kind: 'interval'
  minutes: number
}

interface CustomSchedule {
  kind: 'custom'
  expression: string
}

type ScheduleConfig =
  | DailySchedule
  | WeeklySchedule
  | MonthlySchedule
  | HourlySchedule
  | IntervalSchedule
  | CustomSchedule

const SCHEDULE_KIND_OPTIONS: readonly { value: ScheduleKind; label: string }[] = [
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
  { value: 'hourly', label: '每小时' },
  { value: 'interval', label: '按分钟' },
  { value: 'custom', label: '自定义' }
]

/** 周一在前：中文语境里「这周」从周一开始，周日放末尾 */
const WEEKDAY_OPTIONS: readonly { value: number; short: string; label: string }[] = [
  { value: 1, short: '一', label: '周一' },
  { value: 2, short: '二', label: '周二' },
  { value: 3, short: '三', label: '周三' },
  { value: 4, short: '四', label: '周四' },
  { value: 5, short: '五', label: '周五' },
  { value: 6, short: '六', label: '周六' },
  { value: 0, short: '日', label: '周日' }
]

/** 常用组合：点一下比连点五天省事，也让表达式更短（工作日 = `1-5`） */
const WEEKLY_PRESETS: readonly { label: string; weekdays: number[] }[] = [
  { label: '工作日', weekdays: [1, 2, 3, 4, 5] },
  { label: '周末', weekdays: [6, 0] }
]

/** 分钟间隔的常用档：步进值上限 59，给到 30 足够覆盖轮询类任务 */
const MINUTE_INTERVAL_OPTIONS: readonly number[] = [1, 5, 10, 15, 20, 30]

const MONTH_DAYS: readonly number[] = Array.from({ length: 31 }, function (_, index) {
  return index + 1
})

const MINUTES: readonly number[] = Array.from({ length: 60 }, function (_, index) {
  return index
})

/** 默认值 = 每天 09:00，与仓库原有预设对齐 */
const DEFAULT_SCHEDULE: ScheduleConfig = { kind: 'daily', hour: 9, minute: 0 }

function isValidHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23
}

function isValidMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59
}

/** 按周一到周日的顺序去重排序，保证同样的选择永远生成同一个表达式 */
function sortWeekdays(weekdays: number[]): number[] {
  const seen = new Set<number>()
  const order = WEEKDAY_OPTIONS.map(function (option) {
    return option.value
  })
  return order.filter(function (value) {
    if (!weekdays.includes(value) || seen.has(value)) return false
    seen.add(value)
    return true
  })
}

/**
 * 周字段：只有「周一到周五」压成 `1-5`（cron 与描述函数都认，读起来就是「工作日」）。
 * 其余仍按周一到周日枚举，保证同样的勾选永远生成同一个字符串。
 */
function toWeekdayField(weekdays: number[]): string {
  const sorted = sortWeekdays(weekdays)
  if (sorted.length === 0) return '1'
  if (sorted.join(',') === '1,2,3,4,5') return '1-5'
  return sorted.join(',')
}

function buildSchedule(config: ScheduleConfig): string {
  switch (config.kind) {
    case 'daily':
      return `${config.minute} ${config.hour} * * *`
    case 'weekly': {
      const weekdays = sortWeekdays(config.weekdays)
      return `${config.minute} ${config.hour} * * ${toWeekdayField(weekdays)}`
    }
    case 'monthly':
      return `${config.minute} ${config.hour} ${config.day === 'last' ? 'L' : config.day} * *`
    case 'hourly':
      return `${config.minute} * * * *`
    case 'interval':
      return `*/${config.minutes} * * * *`
    case 'custom':
      return config.expression
  }
}

/**
 * 周字段 → 勾选的星期（周一在前）。认 `1,3,5` 与 `1-5` 两种写法：
 * 后者是老任务 / 「工作日」预设生成的，不能因为形状不同就落到自定义。
 */
function parseWeekdayField(field: string): number[] | null {
  if (field === '') return null
  const days: number[] = []
  for (const part of field.split(',')) {
    const range = /^([0-6])-([0-6])$/.exec(part)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (end < start) return null
      for (let value = start; value <= end; value += 1) days.push(value)
      continue
    }
    if (!/^[0-6]$/.test(part)) return null
    days.push(Number(part))
  }
  return sortWeekdays(days)
}

/**
 * 反向解析：只还原可视化面板能完整表达的形状，其余落 `custom`。
 * 判定顺序与 `describeSchedule` 一致，避免「界面说每天、表达式其实是别的」。
 */
function parseSchedule(expression: string): ScheduleConfig {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return { kind: 'custom', expression }

  const [minuteField, hourField, dayField, monthField, weekdayField] = fields
  if (monthField !== '*') return { kind: 'custom', expression }

  if (dayField === '*' && weekdayField === '*') {
    if (/^\*\/\d{1,2}$/.test(minuteField) && hourField === '*') {
      const step = Number(minuteField.slice(2))
      if (step >= 1 && step <= 59) return { kind: 'interval', minutes: step }
      return { kind: 'custom', expression }
    }
    if (/^\d{1,2}$/.test(minuteField) && hourField === '*') {
      const minute = Number(minuteField)
      if (!isValidMinute(minute)) return { kind: 'custom', expression }
      return { kind: 'hourly', minute }
    }
  }

  if (!/^\d{1,2}$/.test(minuteField) || !/^\d{1,2}$/.test(hourField)) {
    return { kind: 'custom', expression }
  }
  const minute = Number(minuteField)
  const hour = Number(hourField)
  if (!isValidHour(hour) || !isValidMinute(minute)) return { kind: 'custom', expression }

  if (dayField === '*' && weekdayField === '*') return { kind: 'daily', hour, minute }
  if (dayField === '*') {
    const weekdays = parseWeekdayField(weekdayField)
    if (weekdays) return { kind: 'weekly', hour, minute, weekdays }
  }
  if (weekdayField === '*') {
    // `L` = 当月最后一天：2 月 28/29、4 月 30…，界面与描述都按「最后一天」说
    if (dayField.toUpperCase() === 'L') return { kind: 'monthly', hour, minute, day: 'last' }
    if (/^\d{1,2}$/.test(dayField)) {
      const day = Number(dayField)
      if (day >= 1 && day <= 31) return { kind: 'monthly', hour, minute, day }
    }
  }

  return { kind: 'custom', expression }
}

/**
 * 切换频率时尽量保留用户已选的时间：用户在「每天 09:00」上点「每周」，
 * 期望的是「每周一 09:00」，而不是被重置回早上 0 点。
 */
function switchScheduleKind(config: ScheduleConfig, kind: ScheduleKind): ScheduleConfig {
  const hour = 'hour' in config ? config.hour : 9
  const minute = 'minute' in config ? config.minute : 0

  switch (kind) {
    case 'daily':
      return { kind, hour, minute }
    case 'weekly':
      return {
        kind,
        hour,
        minute,
        weekdays: config.kind === 'weekly' ? config.weekdays : [1]
      }
    case 'monthly':
      return {
        kind,
        hour,
        minute,
        day: config.kind === 'monthly' ? config.day : 1
      }
    case 'hourly':
      return { kind, minute }
    case 'interval':
      return {
        kind,
        minutes: config.kind === 'interval' ? config.minutes : 5
      }
    case 'custom':
      return { kind, expression: buildSchedule(config) }
  }
}

/** 给界面用的一句话：先由配置拼表达式，再交给统一的描述函数 */
function describeConfig(config: ScheduleConfig): string {
  return describeSchedule(buildSchedule(config))
}

export {
  DEFAULT_SCHEDULE,
  MINUTES,
  MINUTE_INTERVAL_OPTIONS,
  MONTH_DAYS,
  SCHEDULE_KIND_OPTIONS,
  WEEKDAY_OPTIONS,
  WEEKLY_PRESETS,
  buildSchedule,
  describeConfig,
  parseSchedule,
  sortWeekdays,
  switchScheduleKind
}
export type { ScheduleConfig, ScheduleKind }
