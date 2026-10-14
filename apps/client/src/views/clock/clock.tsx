import { Button } from '@i-thinking/design/components/button'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Decorations } from '@/components/decorations/index.ts'
import { EVENTS } from '@/shared/ipc/channels'
import { findComponentLabel } from '@/constants/marketplace/tile-hints'
import {
  findClockReminders,
  findEnabledCount,
  findNextReminder,
  parseWeekDays
} from '@/features/magnetic-tiles/clock/alarm-time'
import { useSecondTick } from '@/features/magnetic-tiles/clock/use-second-tick.ts'
import { useClockStore } from '@/stores/clock'
import { useReminderStore, type Reminder } from '@/stores/reminder'
import styles from '@/views/clock/clock.module.scss'
import { ClockAlarms, type Draft } from './clock-alarms'
import { ClockPreview } from './clock-preview'
import { findStyleLabel } from './clock-style-constants.ts'
import { ClockStylePicker } from './clock-style-picker.tsx'

const SNOOZE_MS = 9 * 60 * 1000

const EMPTY_DRAFT: Draft = {
  title: '闹钟',
  fireTime: '07:00',
  weekDays: []
}

function closeWindow() {
  void getCurrentWindow().close()
}

function Clock() {
  const { clockStyle, updateClockStyle } = useClockStore()
  const reminders = useReminderStore(function (s) {
    return s.reminders
  })
  const toReadReminders = useReminderStore(function (s) {
    return s.toReadReminders
  })
  const toWriteReminder = useReminderStore(function (s) {
    return s.toWriteReminder
  })
  const toUpdateReminder = useReminderStore(function (s) {
    return s.toUpdateReminder
  })
  const toRemoveReminder = useReminderStore(function (s) {
    return s.toRemoveReminder
  })

  const now = useSecondTick()
  const [editingId, onUpdateEditingId] = useState<string | null>(null)
  const [draft, onUpdateDraft] = useState<Draft>(EMPTY_DRAFT)
  const [isCreating, onUpdateCreating] = useState(false)
  const [saving, onUpdateSaving] = useState(false)

  const clockReminders = useMemo(
    function () {
      return findClockReminders(reminders)
    },
    [reminders]
  )

  useEffect(
    function () {
      void toReadReminders()
    },
    [toReadReminders]
  )

  useEffect(
    function () {
      let unlisten: (() => void) | undefined
      void import('@tauri-apps/api/event').then(function (mod) {
        void mod
          .listen(EVENTS.REMINDER_FIRED, function () {
            void toReadReminders()
          })
          .then(function (fn) {
            unlisten = fn
          })
      })
      return function () {
        unlisten?.()
      }
    },
    [toReadReminders]
  )

  const heroTime = clockStyle === 'minimal' ? now.format('HH:mm') : now.format('HH:mm:ss')
  const styleLabel = findStyleLabel(clockStyle)
  const nextFire = useMemo(
    function () {
      return findNextReminder(clockReminders, now)
    },
    [clockReminders, now]
  )
  const enabledTotal = useMemo(
    function () {
      return findEnabledCount(clockReminders)
    },
    [clockReminders]
  )

  function beginCreate() {
    onUpdateCreating(true)
    onUpdateEditingId(null)
    onUpdateDraft({
      ...EMPTY_DRAFT,
      fireTime: now.add(1, 'hour').startOf('hour').format('HH:mm')
    })
  }

  function beginEdit(reminder: Reminder) {
    onUpdateCreating(false)
    onUpdateEditingId(reminder.id)
    onUpdateDraft({
      title: reminder.title || '闹钟',
      fireTime: reminder.fireTime || '07:00',
      weekDays: parseWeekDays(reminder.weekDays)
    })
  }

  function cancelEdit() {
    onUpdateCreating(false)
    onUpdateEditingId(null)
    onUpdateDraft(EMPTY_DRAFT)
  }

  function toggleDraftDay(day: number) {
    onUpdateDraft(function (prev) {
      const next = prev.weekDays.includes(day)
        ? prev.weekDays.filter(function (d) {
            return d !== day
          })
        : [...prev.weekDays, day].sort(function (a, b) {
            return a - b
          })
      return { ...prev, weekDays: next }
    })
  }

  async function handleSaveDraft() {
    onUpdateSaving(true)
    try {
      const weekDays = JSON.stringify(draft.weekDays)
      if (isCreating) {
        const id = await toWriteReminder({
          title: draft.title.trim() || '闹钟',
          fireTime: draft.fireTime,
          weekDays,
          enabled: true
        })
        if (!id) throw new Error('write failed')
        toast.success('已添加闹钟')
      } else if (editingId) {
        await toUpdateReminder({
          key: editingId,
          change: {
            title: draft.title.trim() || '闹钟',
            fireTime: draft.fireTime,
            weekDays
          }
        })
        toast.success('已更新')
      }
      cancelEdit()
    } catch {
      toast.error('保存失败')
    } finally {
      onUpdateSaving(false)
    }
  }

  async function handleToggle(reminder: Reminder, enabled: boolean) {
    try {
      await toUpdateReminder({
        key: reminder.id,
        change: { enabled, snoozeUntil: null }
      })
    } catch {
      toast.error('更新失败')
    }
  }

  async function handleRemove(id: string) {
    try {
      await toUpdateReminder({
        key: id,
        change: { archivedAt: Date.now() }
      })
      if (editingId === id) cancelEdit()
      toast.success('已归档')
    } catch {
      try {
        await toRemoveReminder(id)
        if (editingId === id) cancelEdit()
        toast.success('已删除')
      } catch {
        toast.error('删除失败')
      }
    }
  }

  async function handleSnooze(reminder: Reminder) {
    try {
      await toUpdateReminder({
        key: reminder.id,
        change: {
          enabled: true,
          snoozeUntil: Date.now() + SNOOZE_MS
        }
      })
      toast.success('已延后 9 分钟')
    } catch {
      toast.error('延后失败')
    }
  }

  const isEditing = isCreating || editingId !== null

  return (
    <Decorations
      summary={findComponentLabel('clock')}
      scrollable={false}
      section={<Button onClick={closeWindow}>完成</Button>}>
      <div className="mt-stage-split">
        <ClockPreview
          now={now}
          clockStyle={clockStyle}
          styleLabel={styleLabel}
          heroTime={heroTime}
          nextFire={nextFire}
          clockRemindersCount={clockReminders.length}
          enabledTotal={enabledTotal}
        />
        <div className={cn('mt-pane-form', styles.formCard)}>
          <ClockStylePicker
            clockStyle={clockStyle}
            onChange={updateClockStyle}
          />
          <ClockAlarms
            clockReminders={clockReminders}
            now={now.valueOf()}
            isEditing={isEditing}
            editingId={editingId}
            draft={draft}
            saving={saving}
            onBeginCreate={beginCreate}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onSaveDraft={function () {
              void handleSaveDraft()
            }}
            onDraftChange={onUpdateDraft}
            onToggleDraftDay={toggleDraftDay}
            onToggle={function (reminder, enabled) {
              void handleToggle(reminder, enabled)
            }}
            onRemove={function (id) {
              void handleRemove(id)
            }}
            onSnooze={function (reminder) {
              void handleSnooze(reminder)
            }}
          />
        </div>
      </div>
    </Decorations>
  )
}

export default Clock
