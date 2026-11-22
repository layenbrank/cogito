import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useMemo, useState } from 'react'

import { findCapacity, isWide } from '@/features/magnetic-tile/marker'
import type { MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import {
  computeCountdown,
  parseWorkDays,
  STATUS_LABELS,
  type CountdownSnapshot,
  type WorkStatus
} from '@/features/magnetic-tiles/countdown/compute'
import { METRIC_ICON } from './constants'
import {
  findFooterStatus,
  findMetricDisplay,
  findProgressTitle,
  findStripText
} from './layout'
import { useClockStore } from '@/stores/clock'

interface CountdownMarkerLayout {
  isCompact: boolean
  showEarn: boolean
  showTrack: boolean
  showFooter: boolean
  showPayday: boolean
  showSalaryDetail: boolean
  showDate: boolean
  showDecor: boolean
  wide: boolean
  progressPct: number
  stripText: string
  metricLabel: string
  metricValue: string
  metricIcon: (typeof METRIC_ICON)[keyof typeof METRIC_ICON]
  isMetricDim: boolean
  footerStatus: string
  progressTitle: string
  workRange: string
  status: WorkStatus
  statusLabel: string
  computed: CountdownSnapshot
  now: Dayjs
  config: ReturnType<typeof useClockStore.getState>['config']
  loaded: boolean
}

function useCountdownMarker(
  size: MarkerProps['size'],
  shape: MarkerProps['shape'],
  direction: MarkerProps['direction']
): CountdownMarkerLayout {
  const { config, loaded, initialize } = useClockStore()
  const [now, onUpdateNow] = useState(function () {
    return dayjs()
  })

  useEffect(
    function () {
      void initialize()
    },
    [initialize]
  )

  useEffect(function () {
    const timer = setInterval(function () {
      onUpdateNow(dayjs())
    }, 1000)
    return function () {
      clearInterval(timer)
    }
  }, [])

  const workDays = useMemo(
    function () {
      return parseWorkDays(config.workDays)
    },
    [config.workDays]
  )

  const computed = useMemo(
    function () {
      if (!loaded) {
        const loading: CountdownSnapshot = {
          status: 'working',
          countdown: '--:--:--',
          progress: 0,
          elapsedSeconds: 0,
          totalWorkSeconds: 0,
          todayEarned: 0,
          dailySalary: 0,
          daysUntilPayday: 0,
          isPayday: false,
          paydayDate: '',
          isValidShift: true
        }
        return loading
      }
      return computeCountdown(
        now,
        config.workStart,
        config.workEnd,
        workDays,
        config.monthlySalary,
        config.payDay
      )
    },
    [now, loaded, config.workStart, config.workEnd, config.monthlySalary, config.payDay, workDays]
  )

  const capacity = findCapacity(size, shape, direction)
  const wide = isWide(shape, direction)
  const statusLabel = STATUS_LABELS[computed.status]
  const workRange = `${config.workStart} – ${config.workEnd}`
  const hasSalary = config.monthlySalary > 0
  const isCompact = size <= 1
  const showEarn = !isCompact && capacity >= 2 && hasSalary
  const showTrack = !isCompact && capacity >= 2
  const showFooter = !isCompact && capacity >= 2
  const showPayday = !isCompact && capacity >= 4
  const showSalaryDetail = !isCompact && capacity >= 5 && hasSalary
  const showDate = !isCompact && capacity >= 6
  const showDecor = !isCompact && (wide ? size >= 2 : size >= 3)
  const progressPct = Math.round(Math.max(computed.progress, computed.status === 'after' ? 100 : 0))

  const stripText = findStripText(computed, statusLabel)
  const metric = findMetricDisplay(computed, statusLabel, hasSalary, showPayday)
  const footerStatus = findFooterStatus(computed, statusLabel)
  const progressTitle = findProgressTitle(computed.status)

  return {
    isCompact,
    showEarn,
    showTrack,
    showFooter,
    showPayday,
    showSalaryDetail,
    showDate,
    showDecor,
    wide,
    progressPct,
    stripText,
    metricLabel: metric.metricLabel,
    metricValue: metric.metricValue,
    metricIcon: metric.metricIcon,
    isMetricDim: metric.isMetricDim,
    footerStatus,
    progressTitle,
    workRange,
    status: computed.status,
    statusLabel,
    computed,
    now,
    config,
    loaded
  }
}

export { METRIC_ICON, useCountdownMarker }
