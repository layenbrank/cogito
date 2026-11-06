/**
 * 消息时间：`年月日时分秒`，本地时区。
 *
 * 为什么不用 `toLocaleString`：不同运行环境（Chromium / Node / CI）给的格式、
 * 分隔符、是否补零都不一样，截图对不上、单测也没法断言。这里自己拼，
 * 输出恒为 `2026-11-06 10:36:00`（`toDateTimeAttr` 给 `<time datetime>` 用的
 * 是 `2026-11-06T10:36:00`，不含时区偏移 —— 它是「本机看到的那一刻」）。
 *
 * 回合的结束时刻 = 起点 + 流式总时长；没有时长（失败 / 秒回）就用起点。
 * 失败回合一样要有时间：那正是用户事后想知道「这一轮什么时候断的」的场面。
 */

const SEPARATOR = ' '

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function toDate(value: number | Date | undefined | null): Date | null {
  if (value === undefined || value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

/** `2026-11-06 10:36:00`；非法值返回空串（调用方按「没有时间」处理） */
function formatMessageTime(value: number | Date | undefined | null): string {
  const date = toDate(value)
  if (!date) return ''
  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  ].join(SEPARATOR)
}

/** `<time datetime>` 的值：`2026-11-06T10:36:00`；非法值返回 undefined */
function toDateTimeAttr(value: number | Date | undefined | null): string | undefined {
  const text = formatMessageTime(value)
  return text ? text.replace(SEPARATOR, 'T') : undefined
}

/**
 * 这一轮结束在哪一刻：`createdAt + totalStreamTime`。
 *
 * `totalStreamTime` 缺失 / 非正数 / 非有限数时退回 `createdAt` ——
 * 回合还没跑起来就失败时，只有起点。
 */
function findMessageMoment(
  createdAt: number | Date | undefined | null,
  totalStreamTime?: number
): number | undefined {
  const start = toDate(createdAt)
  if (!start) return undefined
  const base = start.getTime()
  if (totalStreamTime === undefined || !Number.isFinite(totalStreamTime) || totalStreamTime <= 0) {
    return base
  }
  return base + totalStreamTime
}

export { findMessageMoment, formatMessageTime, toDateTimeAttr }
