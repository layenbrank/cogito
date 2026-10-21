import type { ExceptionRecord } from '@/apis/exception.ts'
import type { UsageRecord } from '@/apis/gateway.ts'
import type { ChartPoint } from '@/components/console/mini-chart.tsx'

const DAY_MS = 86_400_000
const DAILY_WINDOW = 14
const MONTHLY_WINDOW = 6

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayLabel(ms: number) {
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function monthKey(ms: number) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [, month] = key.split('-')
  return `${Number(month)}月`
}

/** 近 N 日：按日去重 userID → 日活序列 */
function buildDailyActive(records: UsageRecord[], now = Date.now()): ChartPoint[] {
  const today = startOfDay(now)
  const buckets = new Map<number, Set<string>>()
  for (let i = DAILY_WINDOW - 1; i >= 0; i -= 1) {
    buckets.set(today - i * DAY_MS, new Set())
  }
  for (const row of records) {
    const day = startOfDay(row.createdAt)
    const users = buckets.get(day)
    if (users) users.add(row.userID)
  }
  return [...buckets.entries()].map(function ([day, users]) {
    return { label: dayLabel(day), value: users.size }
  })
}

/** 近 N 月：按月去重 userID → 月活序列 */
function buildMonthlyActive(records: UsageRecord[], now = Date.now()): ChartPoint[] {
  const cursor = new Date(now)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  const keys: string[] = []
  for (let i = MONTHLY_WINDOW - 1; i >= 0; i -= 1) {
    const date = new Date(cursor)
    date.setMonth(cursor.getMonth() - i)
    keys.push(monthKey(date.getTime()))
  }
  const buckets = new Map<string, Set<string>>()
  for (const key of keys) {
    buckets.set(key, new Set())
  }
  for (const row of records) {
    const key = monthKey(row.createdAt)
    const users = buckets.get(key)
    if (users) users.add(row.userID)
  }
  return keys.map(function (key) {
    return { label: monthLabel(key), value: buckets.get(key)?.size ?? 0 }
  })
}

/** 近 N 日客户端异常上报 → 异常序列 */
function buildExceptionSeries(records: ExceptionRecord[], now = Date.now()): ChartPoint[] {
  const today = startOfDay(now)
  const buckets = new Map<number, number>()
  for (let i = DAILY_WINDOW - 1; i >= 0; i -= 1) {
    buckets.set(today - i * DAY_MS, 0)
  }
  for (const row of records) {
    const day = startOfDay(row.receivedAt)
    if (buckets.has(day)) {
      buckets.set(day, (buckets.get(day) ?? 0) + 1)
    }
  }
  return [...buckets.entries()].map(function ([day, value]) {
    return { label: dayLabel(day), value }
  })
}

function buildTokenSeries(records: UsageRecord[], now = Date.now()): ChartPoint[] {
  const today = startOfDay(now)
  const buckets = new Map<number, number>()
  for (let i = DAILY_WINDOW - 1; i >= 0; i -= 1) {
    buckets.set(today - i * DAY_MS, 0)
  }
  for (const row of records) {
    const day = startOfDay(row.createdAt)
    if (buckets.has(day)) {
      buckets.set(day, (buckets.get(day) ?? 0) + row.totalTokens)
    }
  }
  return [...buckets.entries()].map(function ([day, value]) {
    return { label: dayLabel(day), value }
  })
}

function sumPoints(points: ChartPoint[]) {
  return points.reduce(function (sum, point) {
    return sum + point.value
  }, 0)
}

function lastPoint(points: ChartPoint[]) {
  return points[points.length - 1]?.value ?? 0
}

export {
  buildDailyActive,
  buildExceptionSeries,
  buildMonthlyActive,
  buildTokenSeries,
  lastPoint,
  sumPoints
}
