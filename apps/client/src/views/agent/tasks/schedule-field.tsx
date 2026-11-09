/**
 * 时间定义（可视化）：普通用户选「每天 / 每周 / 每月 / 每小时 / 按分钟」+ 时间就能排期，
 * 不必知道 crontab。表达式只在「自定义」里出现，且始终回显一句话描述。
 *
 * 视觉上按「普通人的排期界面」做：频率是一条等宽分段控件，下面是同一列的表单控件
 * （时间 / 日期 / 星期），最后一行是读得出来的人话摘要；cron 缩到摘要右侧当注释。
 * 组件只负责把选择拼成 crontab 交给表单；解析与拼装都在
 * `features/automation/schedule-config.ts`（纯函数、有单测）。
 */
import { Input } from '@cogito/design/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { TimePicker, formatTimeValue, parseTimeValue } from '@cogito/design/components/time-picker'
import { clsx } from 'clsx'
import { useMemo, useState } from 'react'

import { describeSchedule, isValidSchedule } from '@/features/automation/describe-schedule'
import {
  MINUTES,
  MINUTE_INTERVAL_OPTIONS,
  MONTH_DAYS,
  SCHEDULE_KIND_OPTIONS,
  WEEKDAY_OPTIONS,
  WEEKLY_PRESETS,
  buildSchedule,
  parseSchedule,
  switchScheduleKind,
  type ScheduleConfig,
  type ScheduleKind
} from '@/features/automation/schedule-config'
import styles from './tasks.module.scss'

interface ScheduleFieldProps {
  value: string
  onChange: (next: string) => void
}

/** 五个频率各占一格；「自定义」不是频率，是摘要行上的入口，别挤在这一行 */
const VISUAL_KINDS = SCHEDULE_KIND_OPTIONS.filter(function (option) {
  return option.value !== 'custom'
})

/**
 * 「最后一天」放第一项：它是「每月」里最常见的诉求，藏在下拉末尾等于没有。
 * 值用字符串 `last`（与 `schedule-config.ts` 的 `day: 'last'` 对应），cron 里记作 `L`。
 */
const MONTH_DAY_ITEMS: readonly { value: string; label: string }[] = [
  { value: 'last', label: '最后一天' },
  ...MONTH_DAYS.map(function (day) {
    return { value: String(day), label: `${day} 号` }
  })
]

const MINUTE_ITEMS = MINUTES.map(function (minute) {
  return {
    value: String(minute),
    label: minute === 0 ? '整点（0 分）' : `第 ${minute} 分`
  }
})

function ScheduleField(props: ScheduleFieldProps) {
  const config = useMemo(
    function () {
      return parseSchedule(props.value)
    },
    [props.value]
  )
  /**
   * 「自定义」是粘性模式：用户手打表达式时即使内容刚好能被解析成「每天」，
   * 也不能把面板抢回可视化态（输入框会突然消失）。
   */
  const [isCustomMode, setCustomMode] = useState(config.kind === 'custom')
  const kind: ScheduleKind = isCustomMode ? 'custom' : config.kind
  const isValid = isValidSchedule(props.value)
  const preview = describeSchedule(props.value)
  const expression = props.value.trim()
  const hasTime = config.kind === 'daily' || config.kind === 'weekly' || config.kind === 'monthly'

  function commit(next: ScheduleConfig) {
    props.onChange(buildSchedule(next))
  }

  function changeKind(next: ScheduleKind) {
    if (next === 'custom') {
      setCustomMode(true)
      return
    }
    setCustomMode(false)
    if (config.kind !== next) commit(switchScheduleKind(config, next))
  }

  function changeTime(raw: string) {
    const parsed = parseTimeValue(raw)
    if (!parsed) return
    if (hasTime) {
      commit({ ...config, hour: parsed.hour, minute: parsed.minute })
    }
  }

  /**
   * 可视化 ↔ 自定义互切。
   * 从自定义切回来时先按反向解析还原；认不出来的表达式（带秒、月份限定等）
   * 退回「每天 09:00」—— 用户点的是「改用可视化」，这一步本来就允许丢表达式。
   */
  function toggleCustom() {
    if (kind !== 'custom') {
      setCustomMode(true)
      return
    }
    const parsed = parseSchedule(props.value)
    setCustomMode(false)
    commit(parsed.kind === 'custom' ? { kind: 'daily', hour: 9, minute: 0 } : parsed)
  }

  function renderTime() {
    if (!hasTime) return null
    return (
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>时间</span>
        <TimePicker
          className="text-sm"
          aria-label="触发时间（时:分）"
          value={formatTimeValue(config.hour, config.minute)}
          onChange={function (event) {
            changeTime(event.target.value)
          }}
        />
      </div>
    )
  }

  function renderMonthlyDay() {
    if (config.kind !== 'monthly') return null
    return (
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>日期</span>
        <Select
          items={MONTH_DAY_ITEMS}
          value={config.day === 'last' ? 'last' : String(config.day)}
          onValueChange={function (value) {
            if (typeof value !== 'string') return
            commit({ ...config, day: value === 'last' ? 'last' : Number(value) })
          }}>
          <SelectTrigger aria-label="每月哪一天">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MONTH_DAY_ITEMS.map(function (item) {
              return (
                <SelectItem
                  key={item.value}
                  value={item.value}>
                  {item.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    )
  }

  function renderWeekdays() {
    if (config.kind !== 'weekly') return null
    return (
      <div className={styles.fieldGroup}>
        <div className={styles.weekLabelRow}>
          <span className={styles.fieldLabel}>星期</span>
          {WEEKLY_PRESETS.map(function (preset) {
            // 完全一致才算选中：勾了周一到周六时不该显示成「工作日」
            const isActive =
              config.weekdays.length === preset.weekdays.length &&
              preset.weekdays.every(function (day) {
                return config.weekdays.includes(day)
              })
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={isActive}
                className={styles.linkBtn}
                onClick={function () {
                  commit({ ...config, weekdays: preset.weekdays })
                }}>
                {preset.label}
              </button>
            )
          })}
        </div>
        <div
          className={styles.weekGrid}
          role="group"
          aria-label="每周哪几天">
          {WEEKDAY_OPTIONS.map(function (option) {
            const isActive = config.weekdays.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                aria-label={option.label}
                aria-pressed={isActive}
                className={clsx(styles.weekCell, isActive && styles.weekCellActive)}
                onClick={function () {
                  // 至少留一天：全取消等于「不排期」，用户真正想要的是停用任务
                  if (isActive && config.weekdays.length === 1) return
                  const weekdays = isActive
                    ? config.weekdays.filter(function (value) {
                        return value !== option.value
                      })
                    : [...config.weekdays, option.value]
                  commit({ ...config, weekdays })
                }}>
                {option.short}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderHourlyMinute() {
    if (config.kind !== 'hourly') return null
    return (
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>每小时的第几分</span>
        <Select
          items={MINUTE_ITEMS}
          value={String(config.minute)}
          onValueChange={function (value) {
            if (typeof value !== 'string') return
            commit({ kind: 'hourly', minute: Number(value) })
          }}>
          <SelectTrigger aria-label="每小时的几分">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MINUTE_ITEMS.map(function (item) {
              return (
                <SelectItem
                  key={item.value}
                  value={item.value}>
                  {item.label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
    )
  }

  function renderInterval() {
    if (config.kind !== 'interval') return null
    return (
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>间隔（分钟）</span>
        <div
          className={styles.segmented}
          role="group"
          aria-label="每隔几分钟">
          {MINUTE_INTERVAL_OPTIONS.map(function (minutes) {
            return (
              <button
                key={minutes}
                type="button"
                aria-pressed={config.minutes === minutes}
                aria-label={`每 ${minutes} 分钟`}
                className={styles.segment}
                onClick={function () {
                  commit({ kind: 'interval', minutes })
                }}>
                {minutes}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function renderCustom() {
    if (kind !== 'custom') return null
    return (
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>crontab 表达式</span>
        <Input
          value={props.value}
          className="font-mono text-xs"
          placeholder="0 9 * * 1-5"
          aria-label="crontab 表达式"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
        />
        <p className={styles.fieldHint}>5 段：分 时 日 月 周</p>
        <p className={styles.fieldHint}>
          <code className={styles.scheduleCode}>0 9 * * 1-5</code> = 工作日 09:00
        </p>
      </div>
    )
  }

  return (
    <div className={styles.fieldGroup}>
      <span className={styles.fieldLabel}>重复</span>

      <div className={styles.schedule}>
        {/*
         * 分段控件常驻：进自定义后它仍在，点任意一格就能切回可视化。
         * 隐藏它会让人只剩一个「看不懂的表达式」可看，退不回来。
         */}
        <div
          className={styles.segmented}
          role="group"
          aria-label="重复频率">
          {VISUAL_KINDS.map(function (option) {
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                className={styles.segment}
                onClick={function () {
                  changeKind(option.value)
                }}>
                {option.label}
              </button>
            )
          })}
        </div>

        {kind !== 'custom' ? (
          config.kind === 'monthly' ? (
            <div className={styles.schedulePair}>
              {renderMonthlyDay()}
              {renderTime()}
            </div>
          ) : (
            <div className={styles.scheduleFields}>
              {renderTime()}
              {renderWeekdays()}
              {renderHourlyMinute()}
              {renderInterval()}
            </div>
          )
        ) : null}

        {renderCustom()}

        <div className={styles.scheduleSummary}>
          <span className={clsx(styles.scheduleHuman, !isValid && styles.scheduleHumanInvalid)}>
            {isValid ? preview : '表达式不合法'}
          </span>
          {isValid && kind !== 'custom' && expression && preview !== expression ? (
            <code
              className={styles.scheduleCode}
              title={expression}>
              {expression}
            </code>
          ) : null}
          <button
            type="button"
            aria-pressed={kind === 'custom'}
            className={clsx(styles.segment, styles.scheduleCustom)}
            onClick={toggleCustom}>
            {kind === 'custom' ? '改用可视化' : '自定义'}
          </button>
        </div>
      </div>

      {!isValid ? (
        <p className={clsx(styles.fieldHint, styles.fieldWarn)}>
          时间表达式不合法：请检查段数（5–7 段）与字符
        </p>
      ) : null}

      {config.kind === 'monthly' && config.day === 'last' ? (
        <p className={styles.fieldHint}>
          每月最后一天：1 月 31 日、2 月 28/29 日、4 月 30 日……天数由日历决定，不用自己算。
        </p>
      ) : null}
      {config.kind === 'monthly' && config.day !== 'last' && config.day > 28 ? (
        <p className={styles.fieldHint}>
          小月没有 {config.day} 号，那几个月会自动跳过。想每月都跑请选「最后一天」。
        </p>
      ) : null}
    </div>
  )
}

export { ScheduleField }
export type { ScheduleFieldProps }
