/**
 * 日程计划解析：把 plan 场景的结构化输出变成可预览、可批量写入的日程。
 *
 * 约定（与 prompts.ts 的 plan 场景一致）：
 * - 模型输出 `{"events":[{"title","notes","startISO","endISO","entireDay","color"}]}`；
 * - `startISO` / `endISO` 必须带本地偏移（或 Z），这里统一换成 epoch 毫秒；
 * - 全天事件：`endAt = 次日 00:00 - 1ms`（与日历视图的高亮区间一致）。
 */
import { z } from 'zod'

import type { CalendarWrite } from '@/stores/calendar'

const ScheduleEventSchema = z.object({
  title: z.string().min(1),
  notes: z.string().nullish(),
  startISO: z.string().min(1),
  endISO: z.string().min(1).nullish(),
  entireDay: z.boolean().nullish(),
  color: z.string().nullish()
})

const SchedulePlanSchema = z.object({
  events: z.array(ScheduleEventSchema).min(1)
})

type ScheduleEvent = z.infer<typeof ScheduleEventSchema>

/** 预览行：比 CalendarWrite 多带一份人可读的时间，便于界面上直接改 */
interface ScheduleRow {
  key: string
  title: string
  notes: string
  startAt: number
  endAt: number
  entireDay: boolean
  color: string | null
  /** 原始 ISO（界面回显/编辑用） */
  startISO: string
  endISO: string
}

function nextDayStart(ms: number): number {
  const date = new Date(ms)
  date.setHours(24, 0, 0, 0)
  return date.getTime()
}

function parseDate(value: string): number | null {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function toRow(event: ScheduleEvent, index: number): ScheduleRow | null {
  const startAt = parseDate(event.startISO)
  if (startAt === null) return null
  const entireDay = event.entireDay === true
  let endAt = event.endISO ? parseDate(event.endISO) : null
  if (endAt === null) {
    if (!entireDay) return null
    endAt = nextDayStart(startAt) - 1
  }
  if (entireDay) endAt = nextDayStart(startAt) - 1
  if (endAt <= startAt) return null
  return {
    key: `schedule-${index}-${startAt}`,
    title: event.title.trim(),
    notes: (event.notes ?? '').trim(),
    startAt,
    endAt,
    entireDay,
    color: event.color ?? null,
    startISO: new Date(startAt).toISOString(),
    endISO: new Date(endAt).toISOString()
  }
}

/** 从助手正文里解析日程计划（容忍围栏 / 说明文字） */
function parseSchedulePlan(text: string): ScheduleRow[] {
  const candidates: string[] = []
  const fenced = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g
  let match = fenced.exec(text)
  while (match) {
    const body = match[1]?.trim()
    if (body) candidates.push(body)
    match = fenced.exec(text)
  }
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) candidates.push(trimmed)

  for (const candidate of candidates) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch (error) {
      console.debug('[agent/schedule-plan] 跳过非 JSON 块:', error)
      continue
    }
    const parsed = SchedulePlanSchema.safeParse(value)
    if (!parsed.success) continue
    const rows = parsed.data.events
      .map(function (event, index) {
        return toRow(event, index)
      })
      .filter(function (row): row is ScheduleRow {
        return row !== null
      })
    if (rows.length > 0) return rows
  }
  return []
}

function toWrites(rows: readonly ScheduleRow[]): CalendarWrite[] {
  return rows.map(function (row) {
    return {
      title: row.title,
      notes: row.notes,
      startAt: row.startAt,
      endAt: row.endAt,
      entireDay: row.entireDay,
      color: row.color
    }
  })
}

/** 与已有日程的重叠（只提示，不阻断） */
function findOverlaps(
  rows: readonly ScheduleRow[],
  existing: readonly { id: string; title: string; startAt: number; endAt: number }[]
): string[] {
  const conflicts: string[] = []
  for (const row of rows) {
    for (const event of existing) {
      if (row.startAt < event.endAt && event.startAt < row.endAt) {
        conflicts.push(`「${row.title}」与「${event.title}」时间重叠`)
        break
      }
    }
  }
  return conflicts
}

export { findOverlaps, parseSchedulePlan, toWrites }
export type { ScheduleRow }
