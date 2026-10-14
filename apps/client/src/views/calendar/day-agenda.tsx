import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import { Checkbox } from '@i-thinking/design/components/checkbox'
import { Input } from '@i-thinking/design/components/input'
import { Textarea } from '@i-thinking/design/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@i-thinking/design/components/toggle-group'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'

import styles from '@/views/calendar/day-agenda.module.scss'
import type { Calendar } from '@/stores/calendar'
import type { Reminder } from '@/stores/reminder'

type AgendaKind = 'event' | 'reminder'

type DayAgendaProps = {
  date: Dayjs
  events: Calendar[]
  reminders: Reminder[]
  onWriteEvent: (title: string, notes: string) => Promise<void>
  onWriteReminder: (title: string, notes: string) => Promise<void>
  onToggleReminder: (id: string, isCompleted: boolean) => Promise<void>
  onRemoveEvent: (id: string) => Promise<void>
  onRemoveReminder: (id: string) => Promise<void>
}

type AgendaItem = {
  id: string
  kind: AgendaKind
  title: string
  notes: string
  isCompleted?: boolean
  timeLabel: string
}

function formatTimeLabel(ms: number, entireDay: boolean): string {
  if (entireDay) return '全天'
  const date = new Date(ms)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function DayAgenda(props: DayAgendaProps) {
  const dateKey = props.date.format('YYYY-MM-DD')
  return (
    <DayAgendaInner
      key={dateKey}
      {...props}
    />
  )
}

function DayAgendaInner(props: DayAgendaProps) {
  const {
    date,
    events,
    reminders,
    onWriteEvent,
    onWriteReminder,
    onToggleReminder,
    onRemoveEvent,
    onRemoveReminder
  } = props
  const [composing, onUpdateComposing] = useState(false)
  const [kind, onUpdateKind] = useState<AgendaKind>('reminder')
  const [title, onUpdateTitle] = useState('')
  const [notes, onUpdateNotes] = useState('')
  const [isTitleInvalid, onUpdateTitleInvalid] = useState(false)
  const [submitting, onUpdateSubmitting] = useState(false)

  const items = useMemo(
    function (): AgendaItem[] {
      const eventItems: AgendaItem[] = events.map(function (event) {
        return {
          id: event.id,
          kind: 'event',
          title: event.title,
          notes: event.notes,
          timeLabel: formatTimeLabel(event.startAt, event.entireDay)
        }
      })
      const reminderItems: AgendaItem[] = reminders.map(function (reminder) {
        return {
          id: reminder.id,
          kind: 'reminder',
          title: reminder.title,
          notes: reminder.notes,
          isCompleted: reminder.archivedAt !== null && reminder.archivedAt !== undefined,
          timeLabel: formatTimeLabel(reminder.dueAt ?? 0, reminder.entireDay)
        }
      })
      return [...eventItems, ...reminderItems].sort(function (a, b) {
        if (a.timeLabel === '全天' && b.timeLabel !== '全天') return -1
        if (b.timeLabel === '全天' && a.timeLabel !== '全天') return 1
        return a.timeLabel.localeCompare(b.timeLabel)
      })
    },
    [events, reminders]
  )

  function handleOpen() {
    onUpdateTitle('')
    onUpdateNotes('')
    onUpdateTitleInvalid(false)
    onUpdateKind('reminder')
    onUpdateComposing(true)
  }

  function handleCancel() {
    onUpdateComposing(false)
    onUpdateTitle('')
    onUpdateNotes('')
    onUpdateTitleInvalid(false)
  }

  async function handleSubmit() {
    const nextTitle = title.trim()
    if (!nextTitle) {
      onUpdateTitleInvalid(true)
      return
    }
    onUpdateSubmitting(true)
    try {
      if (kind === 'event') {
        await onWriteEvent(nextTitle, notes.trim())
      } else {
        await onWriteReminder(nextTitle, notes.trim())
      }
      onUpdateComposing(false)
      onUpdateTitle('')
      onUpdateNotes('')
      onUpdateTitleInvalid(false)
    } finally {
      onUpdateSubmitting(false)
    }
  }

  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h3 className={styles.title}>日程</h3>
          <span className={styles.subtitle}>{date.format('M月D日')}</span>
          <span className={styles.count}>{items.length} 项</span>
        </div>
        {!composing ? (
          <Button
            size="sm"
            onClick={handleOpen}>
            <Icon icon="lucide:plus" />
            添加
          </Button>
        ) : null}
      </header>

      <div
        className={clsx(styles.composer, !composing && styles.composerHidden)}
        aria-hidden={!composing}>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          value={[kind]}
          className="w-full"
          onValueChange={function (value) {
            const next = value[0]
            if (next) onUpdateKind(next as AgendaKind)
          }}>
          <ToggleGroupItem
            value="reminder"
            className="grow basis-0 data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
            提醒
          </ToggleGroupItem>
          <ToggleGroupItem
            value="event"
            className="grow basis-0 data-[pressed]:bg-primary/10 data-[pressed]:text-primary">
            事件
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="flex flex-col gap-2">
          <label className="mt-field">
            <span className="mt-field-label">标题</span>
            <Input
              value={title}
              placeholder="例如：周会 / 客户跟进"
              maxLength={80}
              aria-invalid={isTitleInvalid}
              onChange={function (event) {
                onUpdateTitle(event.target.value)
                if (isTitleInvalid) onUpdateTitleInvalid(false)
              }}
            />
            {isTitleInvalid ? (
              <span className="text-xs leading-snug text-destructive">请输入标题</span>
            ) : null}
          </label>
          <label className="mt-field">
            <span className="mt-field-label">备注</span>
            <Textarea
              value={notes}
              placeholder="可选"
              rows={2}
              maxLength={200}
              onChange={function (event) {
                onUpdateNotes(event.target.value)
              }}
            />
          </label>
        </div>
        <div className="flex w-full justify-end">
          <Button
            size="sm"
            onClick={handleCancel}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={submitting}
            onClick={function () {
              void handleSubmit()
            }}>
            保存
          </Button>
        </div>
      </div>

      <div className={styles.list}>
        {items.length === 0 && !composing ? (
          <div className={styles.empty}>
            <div className={styles.emptyTitle}>当日暂无日程</div>
            <div className={styles.emptyDesc}>可添加提醒或事件，便于跟进当日安排。</div>
            <Button
              variant="link"
              size="sm"
              className="self-start"
              onClick={handleOpen}>
              <Icon icon="lucide:plus" />
              新建日程
            </Button>
          </div>
        ) : null}
        {items.map(function (item) {
          return (
            <div
              key={`${item.kind}-${item.id}`}
              className={styles.item}>
              <div
                className={clsx(styles.accent, item.kind === 'reminder' && styles.accentReminder)}
              />
              {item.kind === 'reminder' ? (
                <Checkbox
                  checked={Boolean(item.isCompleted)}
                  onCheckedChange={function (checked) {
                    void onToggleReminder(item.id, checked)
                  }}
                />
              ) : null}
              <div className={styles.itemBody}>
                <div className={clsx(styles.itemTitle, item.isCompleted && styles.itemTitleDone)}>
                  {item.title}
                </div>
                <div className={styles.itemMeta}>
                  <span className={styles.kind}>{item.kind === 'event' ? '事件' : '提醒'}</span>
                  <span>{item.timeLabel}</span>
                  {item.notes ? <span className={styles.notes}>{item.notes}</span> : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className={styles.remove}
                aria-label="删除"
                onClick={function () {
                  if (item.kind === 'event') {
                    void onRemoveEvent(item.id)
                  } else {
                    void onRemoveReminder(item.id)
                  }
                }}>
                <Icon icon="lucide:trash-2" />
              </Button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export { DayAgenda }
export type { DayAgendaProps }
