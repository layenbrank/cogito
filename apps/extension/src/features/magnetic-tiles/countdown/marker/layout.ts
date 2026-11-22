import type { CountdownSnapshot } from '@/features/magnetic-tiles/countdown/compute'

import { METRIC_ICON } from './constants'

interface MetricDisplay {
  metricLabel: string
  metricValue: string
  metricIcon: (typeof METRIC_ICON)[keyof typeof METRIC_ICON]
  isMetricDim: boolean
}

function findMetricDisplay(
  computed: CountdownSnapshot,
  statusLabel: string,
  hasSalary: boolean,
  showPayday: boolean
): MetricDisplay {
  let metricLabel = statusLabel
  let metricValue = computed.countdown
  let metricIcon: (typeof METRIC_ICON)[keyof typeof METRIC_ICON] = METRIC_ICON.countdown
  let isMetricDim = false

  if (computed.status === 'after' || computed.status === 'rest') {
    if (hasSalary && !showPayday) {
      metricLabel = computed.isPayday ? '发薪日' : '距发薪'
      metricValue = computed.isPayday ? '今天' : `${computed.daysUntilPayday}天`
      metricIcon = METRIC_ICON.payday
    } else {
      metricLabel = '状态'
      metricValue = computed.status === 'after' ? '已完成' : '休息中'
      metricIcon = METRIC_ICON.status
      isMetricDim = true
    }
  } else if (computed.status === 'before') {
    metricLabel = statusLabel
    metricValue = computed.countdown
    metricIcon = METRIC_ICON.countdown
  }

  return { metricLabel, metricValue, metricIcon, isMetricDim }
}

function findFooterStatus(computed: CountdownSnapshot, statusLabel: string): string {
  if (computed.status === 'working') return '工作中'
  if (computed.status === 'before') return '未开始'
  return statusLabel
}

function findProgressTitle(status: CountdownSnapshot['status']): string {
  if (status === 'after') return '班次'
  if (status === 'rest') return '本日'
  return '进度'
}

function findStripText(computed: CountdownSnapshot, statusLabel: string): string {
  if (computed.status === 'working' || computed.status === 'before') {
    return computed.countdown
  }
  return statusLabel
}

export { findMetricDisplay, findFooterStatus, findProgressTitle, findStripText }
