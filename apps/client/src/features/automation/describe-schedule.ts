/**
 * cron 表达式的可读描述 + 面板里的常用预设。
 *
 * 只认最常见的几种形状（每天/每周/每月/每 N 分钟/每 N 小时），其余原样显示表达式 ——
 * 猜错比不猜更糟：用户看到「每天 09:00」却实际跑在别的时刻，排查成本极高。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** 面板下拉里的常用预设（值是 crontab 5 段） */
const SCHEDULE_PRESETS: readonly { label: string; value: string }[] = [
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 18:00', value: '0 18 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每小时', value: '0 * * * *' }
]

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function asNumber(field: string): number | null {
  if (!/^\d{1,2}$/.test(field)) return null
  const value = Number(field)
  return Number.isFinite(value) ? value : null
}

/** 把 5 段 cron 描述成一句中文；不认识的形状原样返回 */
function describeSchedule(expression: string): string {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return expression

  const [minute, hour, day, month, weekday] = fields

  if (minute.startsWith('*/') && hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const step = asNumber(minute.slice(2))
    return step ? `每 ${step} 分钟` : expression
  }
  if (minute === '0' && hour.startsWith('*/') && day === '*' && month === '*' && weekday === '*') {
    const step = asNumber(hour.slice(2))
    return step ? `每 ${step} 小时` : expression
  }

  const atMinute = asNumber(minute)
  const atHour = asNumber(hour)
  if (atMinute === null || atHour === null) return expression
  const at = `${pad(atHour)}:${pad(atMinute)}`

  if (day === '*' && month === '*' && weekday === '*') return `每天 ${at}`
  if (day === '*' && month === '*' && /^[0-6]$/.test(weekday)) {
    return `每${WEEKDAYS[Number(weekday)]} ${at}`
  }
  const onDay = asNumber(day)
  if (onDay !== null && month === '*' && weekday === '*') return `每月 ${onDay} 号 ${at}`

  return expression
}

export { SCHEDULE_PRESETS, describeSchedule }
