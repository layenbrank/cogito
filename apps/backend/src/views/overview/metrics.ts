import type { ExceptionRecord, ExceptionSummary } from '@/apis/exception.ts'
import type { UsageRecord } from '@/apis/gateway.ts'
import type { TenantSummary } from '@/apis/tenant.ts'
import type { ChartPoint } from '@/components/console/chart.ts'

const DAY_MS = 86_400_000
const DAILY_WINDOW = 14
const MONTHLY_WINDOW = 6
const TOP_MODEL_LIMIT = 8

interface NamedCount {
  name: string
  value: number
}

const TENANT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '正常',
  SUSPENDED: '停用',
  ARCHIVED: '归档',
  PENDING: '待审'
}

const EXCEPTION_LEVEL_LABELS: Record<string, string> = {
  fatal: '致命',
  error: '错误',
  warning: '警告',
  info: '信息',
  debug: '调试'
}

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

function sortByValueDesc(items: NamedCount[]) {
  return [...items].sort(function (a, b) {
    return b.value - a.value
  })
}

/** 近窗按模型聚合请求次数 */
function buildModelRequestCounts(records: UsageRecord[]): NamedCount[] {
  const buckets = new Map<string, number>()
  for (const row of records) {
    const key = row.modelID || '未知模型'
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return sortByValueDesc(
    [...buckets.entries()].map(function ([name, value]) {
      return { name, value }
    })
  ).slice(0, TOP_MODEL_LIMIT)
}

/** 异常摘要 → 级别分布 */
function buildExceptionLevelCounts(summary: ExceptionSummary | undefined): NamedCount[] {
  if (!summary?.byLevel) return []
  return sortByValueDesc(
    Object.entries(summary.byLevel).map(function ([key, value]) {
      return {
        name: EXCEPTION_LEVEL_LABELS[key] ?? key,
        value
      }
    })
  ).filter(function (item) {
    return item.value > 0
  })
}

/** 租户列表 → 状态分布 */
function buildTenantStatusCounts(tenants: TenantSummary[]): NamedCount[] {
  const buckets = new Map<string, number>()
  for (const row of tenants) {
    const key = row.status || 'UNKNOWN'
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return sortByValueDesc(
    [...buckets.entries()].map(function ([key, value]) {
      return {
        name: TENANT_STATUS_LABELS[key] ?? key,
        value
      }
    })
  )
}

export {
  buildDailyActive,
  buildExceptionLevelCounts,
  buildExceptionSeries,
  buildModelRequestCounts,
  buildMonthlyActive,
  buildTenantStatusCounts,
  buildTokenSeries,
  lastPoint,
  sumPoints
}
export type { NamedCount }
