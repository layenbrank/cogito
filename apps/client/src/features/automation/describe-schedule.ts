/**
 * cron 表达式的可读描述 + 合法性校验。
 *
 * 只认最常见的几种形状（每天/每周/每月/每月最后一天/每 N 分钟/每 N 小时），其余原样显示表达式 ——
 * 猜错比不猜更糟：用户看到「每天 09:00」却实际跑在别的时刻，排查成本极高。
 *
 * 「下次触发」不在这里算：仓库没有 cron 解析依赖，两份实现必然漂移。
 * 准确时间以保存后 Rust 回填的 `nextRunAt` 为准。
 */

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

/** cron 字段允许的字符：数字、通配、步进、枚举、区间，以及 cron crate 的 ? / L / W / # */
const FIELD_PATTERN = /^[0-9*/,?#LW-]+$/i

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function asNumber(field: string): number | null {
  if (!/^\d{1,2}$/.test(field)) return null
  const value = Number(field)
  return Number.isFinite(value) ? value : null
}

/** 周字段 → 「周一、周三、周五」；`1-5` 单独说成「工作日」；认不出来返回 null */
function describeWeekdays(field: string): string | null {
  if (field === '1-5') return '工作日'
  if (!/^[0-6](,[0-6])*$/.test(field)) return null
  const names = field.split(',').map(function (value) {
    return WEEKDAYS[Number(value)]
  })
  return names.join('、')
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

  // 「每小时的第 N 分」：整点写 `0`，其余带分（`30 * * * *` → 每小时第 30 分）
  if (hour === '*' && day === '*' && month === '*' && weekday === '*') {
    const everyHour = asNumber(minute)
    if (everyHour === 0) return '每小时整点'
    if (everyHour !== null) return `每小时第 ${everyHour} 分`
    return expression
  }

  const atMinute = asNumber(minute)
  const atHour = asNumber(hour)
  if (atMinute === null || atHour === null) return expression
  const at = `${pad(atHour)}:${pad(atMinute)}`

  // `L` = 当月最后一天：2 月 28/29、4 月 30…，说成「最后一天」而不是某个数字
  if (day.toUpperCase() === 'L' && month === '*' && weekday === '*') {
    return `每月最后一天 ${at}`
  }
  if (day === '*' && month === '*') {
    // 工作日单独说：`每周工作日` 读起来别扭
    if (weekday === '1-5') return `工作日 ${at}`
    const weekdays = describeWeekdays(weekday)
    if (weekdays) return `每${weekdays} ${at}`
  }
  if (day === '*' && month === '*' && weekday === '*') return `每天 ${at}`
  const onDay = asNumber(day)
  if (onDay !== null && month === '*' && weekday === '*') return `每月 ${onDay} 号 ${at}`

  return expression
}

/**
 * 表达式是否可能被 cron 引擎接受：段数 5–7（Rust 侧 5 段补秒、6–7 段直传），
 * 每段只含 cron 语法字符。只做「明显打错」的拦截，具体取值是否越界交给 Rust。
 */
function isValidSchedule(expression: string): boolean {
  const fields = expression.trim().split(/\s+/).filter(Boolean)
  if (fields.length < 5 || fields.length > 7) return false
  return fields.every(function (field) {
    return FIELD_PATTERN.test(field)
  })
}

export { describeSchedule, isValidSchedule }
