import dayjs, { type Dayjs } from 'dayjs'

interface ReminderLike {
  id: string
  title: string
  fireTime: string | null
  weekDays: string
  enabled: boolean
  snoozeUntil: number | null
  archivedAt: number | null
}

interface NextFire {
  reminder: ReminderLike
  at: Dayjs
}

const WEEKDAY_LABELS = ['', '一', '二', '三', '四', '五', '六', '日']

function parseWeekDays(weekDays: string): number[] {
  try {
    const parsed = JSON.parse(weekDays) as number[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter(function (d) {
      return Number.isInteger(d) && d >= 1 && d <= 7
    })
  } catch {
    return []
  }
}

function parseFireTime(fireTime: string): [number, number] {
  const [hours, minutes] = fireTime.split(':').map(Number)
  return [hours || 0, minutes || 0]
}

function findDayOfWeekISO(d: Dayjs) {
  const dow = d.day()
  return dow === 0 ? 7 : dow
}

function buildTimeOnDate(base: Dayjs, fireTime: string) {
  const [hours, minutes] = parseFireTime(fireTime)
  return base.hour(hours).minute(minutes).second(0).millisecond(0)
}

function findNextFire(reminder: ReminderLike, now: Dayjs): Dayjs | null {
  if (!reminder.enabled || (reminder.archivedAt !== null && reminder.archivedAt !== undefined)) return null
  if (!reminder.fireTime) return null

  if (reminder.snoozeUntil) {
    if (reminder.snoozeUntil > now.valueOf()) {
      return dayjs(reminder.snoozeUntil)
    }
    // Expired snooze: due immediately (align with worker)
    return now
  }

  const weekDays = parseWeekDays(reminder.weekDays)
  const isOneShot = weekDays.length === 0

  if (isOneShot) {
    let candidate = buildTimeOnDate(now, reminder.fireTime)
    if (!candidate.isAfter(now)) {
      candidate = candidate.add(1, 'day')
    }
    return candidate
  }

  const weekDaySet = new Set(weekDays)
  for (let offset = 0; offset < 8; offset++) {
    const day = now.add(offset, 'day').startOf('day')
    const iso = findDayOfWeekISO(day)
    if (!weekDaySet.has(iso)) continue
    const candidate = buildTimeOnDate(day, reminder.fireTime)
    if (candidate.isAfter(now)) return candidate
  }

  return null
}

function findNextReminder(reminders: ReminderLike[], now: Dayjs): NextFire | null {
  let best: NextFire | null = null
  for (const reminder of reminders) {
    const at = findNextFire(reminder, now)
    if (!at) continue
    if (!best || at.isBefore(best.at)) {
      best = { reminder, at }
    }
  }
  return best
}

function findTodayEnabledCount(reminders: ReminderLike[], now: Dayjs) {
  const iso = findDayOfWeekISO(now)
  let count = 0
  for (const reminder of reminders) {
    if (!reminder.enabled || (reminder.archivedAt !== null && reminder.archivedAt !== undefined) || !reminder.fireTime) continue
    const weekDays = parseWeekDays(reminder.weekDays)
    if (weekDays.length === 0 || weekDays.includes(iso)) {
      count += 1
    }
  }
  return count
}

function findEnabledCount(reminders: ReminderLike[]) {
  return reminders.filter(function (r) {
    return r.enabled && (r.archivedAt === null || r.archivedAt === undefined) && r.fireTime
  }).length
}

function formatWeekDays(weekDays: string) {
  const days = parseWeekDays(weekDays)
  if (days.length === 0) return '仅一次'
  if (days.length === 7) return '每天'
  if (days.join(',') === '1,2,3,4,5') return '工作日'
  if (days.join(',') === '6,7') return '周末'
  return days
    .map(function (d) {
      return `周${WEEKDAY_LABELS[d] ?? d}`
    })
    .join(' ')
}

function findClockReminders<T extends ReminderLike>(reminders: T[]) {
  return reminders.filter(function (r): r is T & { fireTime: string } {
    return (r.fireTime !== null && r.fireTime !== undefined) && (r.archivedAt === null || r.archivedAt === undefined)
  })
}

export {
  findClockReminders,
  findDayOfWeekISO,
  findEnabledCount,
  findNextFire,
  findNextReminder,
  findTodayEnabledCount,
  formatWeekDays,
  parseFireTime,
  parseWeekDays
}
export type { NextFire, ReminderLike }
