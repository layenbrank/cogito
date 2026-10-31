import dayjs from 'dayjs'

/**
 * 会话里的「天」边界：消息按本地时区归天，只有跨天的那一条才起分隔条。
 *
 * 只做比较与文案，不碰 React —— 分隔条本身在 `thread.aui.tsx`。
 */

/** 与上一条相比是否跨天；会话首条（`previous` 缺省）也算跨天 */
function startsNewDay(time: Date, previous?: Date): boolean {
  if (!previous) return true
  return !dayjs(time).isSame(previous, 'day')
}

type DayWords = {
  today: string
  yesterday: string
}

/**
 * 分隔条文案：今天 / 昨天用注入的词，更早的日期按本地习惯格式化（同年省掉年）。
 * `locale` 缺省交给运行环境的默认语言。
 */
function findDayLabel(date: Date, words: DayWords, locale?: string): string {
  const target = dayjs(date)
  const today = dayjs()
  if (target.isSame(today, 'day')) return words.today
  if (target.isSame(today.subtract(1, 'day'), 'day')) return words.yesterday

  const sameYear = target.year() === today.year()
  return new Intl.DateTimeFormat(
    locale,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { year: 'numeric', month: 'short', day: 'numeric' }
  ).format(date)
}

export { findDayLabel, startsNewDay }
export type { DayWords }
