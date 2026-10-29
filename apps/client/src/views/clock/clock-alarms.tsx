import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Switch } from '@cogito/design/components/switch'
import { cn } from 'cn'
import dayjs from 'dayjs'

import { formatWeekDays } from '@/features/magnetic-tiles/clock/alarm-time'
import type { Reminder } from '@/stores/reminder'
import styles from '@/views/clock/clock.module.scss'

const WEEKDAY_OPTIONS = [
  { label: '一', value: 1 },
  { label: '二', value: 2 },
  { label: '三', value: 3 },
  { label: '四', value: 4 },
  { label: '五', value: 5 },
  { label: '六', value: 6 },
  { label: '日', value: 7 }
]

interface Draft {
  title: string
  fireTime: string
  weekDays: number[]
}

interface ClockAlarmsProps {
  clockReminders: Reminder[]
  /** 当前时间戳（ms）：由上层秒级 tick 传入，渲染期不直接读 Date.now() */
  now: number
  isEditing: boolean
  editingId: string | null
  draft: Draft
  saving: boolean
  onBeginCreate: () => void
  onBeginEdit: (reminder: Reminder) => void
  onCancelEdit: () => void
  onSaveDraft: () => void
  onDraftChange: (updater: (draft: Draft) => Draft) => void
  onToggleDraftDay: (day: number) => void
  onToggle: (reminder: Reminder, enabled: boolean) => void
  onRemove: (id: string) => void
  onSnooze: (reminder: Reminder) => void
}

function ClockAlarms(props: ClockAlarmsProps) {
  return (
    <div className={styles.sectionAlarms}>
      <div className={styles.sectionHead}>
        <h3 className="mt-section-title">闹钟</h3>
        {!props.isEditing ? (
          <Button
            variant="link"
            size="sm"
            onClick={props.onBeginCreate}>
            添加
          </Button>
        ) : null}
      </div>

      {props.isEditing ? (
        <div className={styles.editor}>
          <div className={styles.editorGrid}>
            <label className="mt-field">
              <span className="mt-field-label">时间</span>
              <Input
                type="time"
                value={props.draft.fireTime}
                onChange={function (event) {
                  const value = event.target.value
                  if (!value) return
                  props.onDraftChange(function (draft) {
                    return { ...draft, fireTime: value }
                  })
                }}
              />
            </label>
            <label className="mt-field">
              <span className="mt-field-label">标签</span>
              <Input
                value={props.draft.title}
                maxLength={32}
                onChange={function (event) {
                  const value = event.target.value
                  props.onDraftChange(function (draft) {
                    return { ...draft, title: value }
                  })
                }}
              />
            </label>
          </div>
          <div className="mt-day-block">
            <span className="mt-day-label">重复（不选为仅一次）</span>
            <div
              className="mt-day-chips"
              role="group"
              aria-label="重复星期">
              {WEEKDAY_OPTIONS.map(function (opt) {
                const isOn = props.draft.weekDays.includes(opt.value)
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-day-chip"
                    aria-pressed={isOn}
                    onClick={function () {
                      props.onToggleDraftDay(opt.value)
                    }}>
                    {opt.label}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className={styles.editorActions}>
            <Button onClick={props.onCancelEdit}>取消</Button>
            <Button
              disabled={props.saving}
              onClick={props.onSaveDraft}>
              保存
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.alarmList}>
        {props.clockReminders.length === 0 && !props.isEditing ? (
          <Button
            type="button"
            variant="ghost"
            className={styles.empty}
            onClick={props.onBeginCreate}>
            <Icon
              icon="mdi:alarm-plus"
              width={20}
              height={20}
            />
            <span>添加闹钟</span>
          </Button>
        ) : null}
        {props.clockReminders.map(function (reminder) {
          return (
            <div
              key={reminder.id}
              className={cn(
                styles.alarmItem,
                props.editingId === reminder.id && styles.alarmItemActive
              )}>
              <Button
                type="button"
                variant="ghost"
                className={styles.alarmMain}
                onClick={function () {
                  props.onBeginEdit(reminder)
                }}>
                <span className={styles.alarmTime}>{reminder.fireTime}</span>
                <span className={styles.alarmMeta}>
                  <span className={styles.alarmTitle}>{reminder.title || '闹钟'}</span>
                  <span className={styles.alarmHint}>
                    {formatWeekDays(reminder.weekDays)}
                    {reminder.snoozeUntil && reminder.snoozeUntil > props.now
                      ? ` · 延后至 ${dayjs(reminder.snoozeUntil).format('HH:mm')}`
                      : ''}
                  </span>
                </span>
              </Button>
              <div className={styles.alarmActions}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="延后 9 分钟"
                  onClick={function () {
                    props.onSnooze(reminder)
                  }}>
                  <Icon icon="mdi:sleep" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  aria-label="归档"
                  onClick={function () {
                    props.onRemove(reminder.id)
                  }}>
                  <Icon icon="mdi:trash-can-outline" />
                </Button>
                <Switch
                  size="sm"
                  checked={reminder.enabled}
                  onCheckedChange={function (checked) {
                    props.onToggle(reminder, checked)
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export { ClockAlarms }
export type { ClockAlarmsProps, Draft }
