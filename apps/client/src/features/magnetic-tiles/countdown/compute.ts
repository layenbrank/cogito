import dayjs, { type Dayjs } from 'dayjs'

type WorkStatus = 'before' | 'working' | 'after' | 'rest'

interface CountdownSnapshot {
  status: WorkStatus
  countdown: string
  progress: number
  elapsedSeconds: number
  totalWorkSeconds: number
  todayEarned: number
  dailySalary: number
  daysUntilPayday: number
  isPayday: boolean
  paydayDate: string
  isValidShift: boolean
}

function padZero(n: number) {
  return String(n).padStart(2, '0')
}

function formatDuration(totalSeconds: number) {
  const secs = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(secs / 3600)
  const minutes = Math.floor((secs % 3600) / 60)
  const seconds = secs % 60
  return `${padZero(hours)}:${padZero(minutes)}:${padZero(seconds)}`
}

function parseClockTime(time: string): [number, number] {
  const [hours, minutes] = time.split(':').map(Number)
  return [hours || 0, minutes || 0]
}

function buildTimeOnDate(base: Dayjs, time: string) {
  const [hours, minutes] = parseClockTime(time)
  return base.hour(hours).minute(minutes).second(0).millisecond(0)
}

function countWorkDays(year: number, month: number, workDays: number[]) {
  const daysInMonth = dayjs(new Date(year, month, 1)).daysInMonth()
  const workDaySet = new Set(workDays)
  let count = 0
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = dayjs(new Date(year, month, d)).day()
    const iso = dow === 0 ? 7 : dow
    if (workDaySet.has(iso)) count++
  }
  return Math.max(1, count)
}

function findDayOfWeekISO(d: Dayjs) {
  const dow = d.day()
  return dow === 0 ? 7 : dow
}

function clampDayToMonth(base: Dayjs, day: number) {
  return base.date(Math.min(day, base.daysInMonth()))
}

function parseWorkDays(workDays: string): number[] {
  try {
    return JSON.parse(workDays) as number[]
  } catch {
    return [1, 2, 3, 4, 5]
  }
}

function emptySnapshot(isValidShift: boolean): CountdownSnapshot {
  return {
    status: 'rest',
    countdown: '--:--:--',
    progress: 0,
    elapsedSeconds: 0,
    totalWorkSeconds: 0,
    todayEarned: 0,
    dailySalary: 0,
    daysUntilPayday: 0,
    isPayday: false,
    paydayDate: '',
    isValidShift
  }
}

function computeCountdown(
  now: Dayjs,
  workStart: string,
  workEnd: string,
  workDays: number[],
  monthlySalary: number,
  payDay: number
): CountdownSnapshot {
  const startTime = buildTimeOnDate(now, workStart)
  const endTime = buildTimeOnDate(now, workEnd)
  const shiftSeconds = endTime.diff(startTime, 'second')
  if (shiftSeconds <= 0) {
    return emptySnapshot(false)
  }

  const isoDay = findDayOfWeekISO(now)
  const isWorkDay = workDays.includes(isoDay)
  const totalWorkSeconds = shiftSeconds

  let status: WorkStatus
  let countdown = '00:00:00'
  let progress = 0
  let elapsedSeconds = 0

  if (!isWorkDay) {
    status = 'rest'
  } else if (now.isBefore(startTime)) {
    status = 'before'
    countdown = formatDuration(startTime.diff(now, 'second'))
  } else if (now.isBefore(endTime) || now.isSame(endTime)) {
    status = 'working'
    elapsedSeconds = now.diff(startTime, 'second')
    const remaining = endTime.diff(now, 'second')
    countdown = formatDuration(remaining)
    progress = Math.min(100, (elapsedSeconds / totalWorkSeconds) * 100)
  } else {
    status = 'after'
    progress = 100
    elapsedSeconds = totalWorkSeconds
  }

  let todayEarned = 0
  const workingDays = countWorkDays(now.year(), now.month(), workDays)
  const dailySalary = monthlySalary > 0 ? monthlySalary / workingDays : 0
  if (monthlySalary > 0 && (status === 'working' || status === 'after') && isWorkDay) {
    todayEarned = (Math.min(elapsedSeconds, totalWorkSeconds) / totalWorkSeconds) * dailySalary
  }

  const today = now.date()
  let daysUntilPayday = 0
  let isPayday = false
  let paydayDate = ''

  const clampedThisMonth = clampDayToMonth(now, payDay)
  const payDayThisMonth = clampedThisMonth.date()

  if (today === payDayThisMonth) {
    isPayday = true
    paydayDate = clampedThisMonth.format('MM月DD日')
  } else if (today < payDayThisMonth) {
    daysUntilPayday = clampedThisMonth.diff(now.startOf('day'), 'day')
    paydayDate = clampedThisMonth.format('MM月DD日')
  } else {
    const target = clampDayToMonth(now.add(1, 'month'), payDay)
    daysUntilPayday = target.diff(now.startOf('day'), 'day')
    paydayDate = target.format('MM月DD日')
  }

  return {
    status,
    countdown,
    progress,
    elapsedSeconds,
    totalWorkSeconds,
    todayEarned,
    dailySalary,
    daysUntilPayday,
    isPayday,
    paydayDate,
    isValidShift: true
  }
}

const STATUS_LABELS: Record<WorkStatus, string> = {
  before: '距上班',
  working: '距下班',
  after: '已下班',
  rest: '休息日'
}

export {
  computeCountdown,
  formatDuration,
  parseWorkDays,
  parseClockTime,
  buildTimeOnDate,
  STATUS_LABELS
}
export type { WorkStatus, CountdownSnapshot }
