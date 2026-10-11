import { useEffect, useMemo } from 'react'

import {
  findClockReminders,
  findEnabledCount,
  findNextReminder,
  findTodayEnabledCount
} from '@/features/magnetic-tiles/clock/alarm-time'
import { findDayPeriod } from '@/features/magnetic-tiles/clock/day-period.ts'
import { useSecondTick } from '@/features/magnetic-tiles/clock/use-second-tick.ts'
import { findCapacity, isWide } from '@/features/magnetic-tile/marker'
import type { MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { EVENTS } from '@/shared/ipc/channels'
import { useClockStore } from '@/stores/clock'
import { useReminderStore } from '@/stores/reminder'

type MarkerLayout = Omit<MarkerProps, 'children'>

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function useClockMarker(props: MarkerLayout) {
  const clockStyle = useClockStore(function (s) {
    return s.clockStyle
  })
  const reminders = useReminderStore(function (s) {
    return s.reminders
  })
  const toReadReminders = useReminderStore(function (s) {
    return s.toReadReminders
  })
  const now = useSecondTick()

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

  const capacity = findCapacity(props.size, props.shape, props.direction)
  const wide = isWide(props.shape, props.direction)
  const isFlip = clockStyle === 'flip'
  const isMinimal = clockStyle === 'minimal'
  const isCircle = props.shape === 'circle'
  const isNeon = clockStyle === 'neon'

  const showSeconds =
    !isMinimal && !isCircle && capacity >= (isFlip ? 3 : 2) && props.size >= (isFlip ? 2 : 1)
  const showAside = capacity >= 2 && !isCircle && !(wide && props.size === 1)
  const showPeriod = capacity >= 3
  const showFullDate = capacity >= 4
  const showWeek = capacity >= 5
  const showNextAlarm = capacity >= 2 && !(wide && props.size === 1)
  const showAlarmSummary = capacity >= 3
  const showSecondAlarm = capacity >= 5
  const useFlipDots = props.size >= 3

  const hours = pad(now.hour())
  const minutes = pad(now.minute())
  const seconds = pad(now.second())
  const period = findDayPeriod(now.hour())
  const dateLabel = showFullDate ? now.format('YYYY年M月D日') : now.format('M月D日')
  const weekday = now.format('dddd')
  const weekOfYear = Math.max(
    1,
    Math.ceil((now.diff(now.startOf('year'), 'day') + now.startOf('year').day() + 1) / 7)
  )

  const clockReminders = useMemo(
    function () {
      return findClockReminders(reminders)
    },
    [reminders]
  )

  const todayEnabled = useMemo(
    function () {
      return findTodayEnabledCount(clockReminders, now)
    },
    [clockReminders, now]
  )

  const enabledTotal = useMemo(
    function () {
      return findEnabledCount(clockReminders)
    },
    [clockReminders]
  )

  const nextReminders = useMemo(
    function () {
      if (!showNextAlarm) return []
      const first = findNextReminder(clockReminders, now)
      if (!first) return []
      if (!showSecondAlarm) return [first]
      const rest = clockReminders.filter(function (r) {
        return r.id !== first.reminder.id
      })
      const second = findNextReminder(rest, now)
      return second ? [first, second] : [first]
    },
    [clockReminders, now, showNextAlarm, showSecondAlarm]
  )

  return {
    clockStyle,
    now,
    hours,
    minutes,
    seconds,
    wide,
    isNeon,
    showSeconds,
    showAside,
    showPeriod,
    showWeek,
    showNextAlarm,
    showAlarmSummary,
    useFlipDots,
    period,
    dateLabel,
    weekday,
    weekOfYear,
    todayEnabled,
    enabledTotal,
    nextReminders
  }
}

export { useClockMarker }
