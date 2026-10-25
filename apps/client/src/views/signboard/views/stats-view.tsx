import { useMemo, useState } from 'react'

import { useSignboardStore, type SignboardEntry, type SignboardColumn } from '@/stores/signboard'
import { BarChart } from '@/views/signboard/charts/charts'
import { ChartPanel } from '@/views/signboard/charts/panel'
import { findChartTheme } from '@/views/signboard/charts/theme'
import { findBoardProgress, findChecklistProgress } from '@/views/signboard/progress'
import styles from '@/views/signboard/signboard.module.scss'

interface StatsViewProps {
  columns: SignboardColumn[]
  entries: SignboardEntry[]
}

const PRIORITY_LABELS = ['无', '低', '中', '高', '紧急'] as const
const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function StatsView(props: StatsViewProps) {
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })

  const active = useMemo(
    function () {
      return props.entries.filter(function (card) {
        return card.archivedAt === null || card.archivedAt === undefined
      })
    },
    [props.entries]
  )

  const boardProgress = useMemo(
    function () {
      return findBoardProgress(active, checksForEntry)
    },
    [active, checksForEntry]
  )

  const columnItems = useMemo(
    function () {
      return props.columns.map(function (column) {
        const count = active.filter(function (card) {
          return card.columnID === column.id
        }).length
        return { name: column.title, value: count }
      })
    },
    [props.columns, active]
  )

  const [today] = useState(function () {
    return startOfDay(Date.now())
  })
  const weekEnd = today + 7 * DAY_MS

  const overdue = active.filter(function (card) {
    return card.dueAt !== null && card.dueAt !== undefined && card.dueAt < today
  }).length

  const dueThisWeek = active.filter(function (card) {
    return (
      card.dueAt !== null &&
      card.dueAt !== undefined &&
      card.dueAt >= today &&
      card.dueAt < weekEnd
    )
  }).length

  const priorityItems = useMemo(
    function () {
      const buckets = [0, 0, 0, 0, 0]
      for (const card of active) {
        const idx = Math.min(Math.max(card.priority, 0), 4)
        buckets[idx] = (buckets[idx] ?? 0) + 1
      }
      return buckets
        .map(function (count, index) {
          return {
            name: PRIORITY_LABELS[index] ?? String(index),
            value: count
          }
        })
        .filter(function (item) {
          return item.value > 0
        })
    },
    [active]
  )

  const progressBuckets = useMemo(
    function () {
      let zero = 0
      let low = 0
      let mid = 0
      let full = 0
      for (const card of active) {
        const progress = findChecklistProgress(checksForEntry(card.id))
        if (progress.total === 0 || progress.pct <= 0) zero += 1
        else if (progress.pct < 50) low += 1
        else if (progress.pct < 100) mid += 1
        else full += 1
      }
      const theme = findChartTheme()
      return [
        { name: '未开始', value: zero, fill: theme.muted },
        { name: '1–49%', value: low, fill: theme.warn },
        { name: '50–99%', value: mid, fill: theme.accent },
        { name: '已完成', value: full, fill: theme.ok }
      ]
    },
    [active, checksForEntry]
  )

  const isColumnEmpty = columnItems.every(function (item) {
    return item.value === 0
  })
  const isPriorityEmpty = priorityItems.length === 0
  const isProgressEmpty = active.length === 0

  return (
    <div className={styles.paneView}>
      <div className={styles.statsMetricsBar}>
        <div>
          <p className={styles.statsMetricValue}>{boardProgress.pct}%</p>
          <p className={styles.statsMetricLabel}>
            完成率
            {boardProgress.total > 0
              ? ` · ${boardProgress.done}/${boardProgress.total}`
              : ' · 暂无清单'}
          </p>
        </div>
        <div>
          <p className={styles.statsMetricValue}>{overdue}</p>
          <p className={styles.statsMetricLabel}>已逾期</p>
        </div>
        <div>
          <p className={styles.statsMetricValue}>{dueThisWeek}</p>
          <p className={styles.statsMetricLabel}>本周到期</p>
        </div>
        <div>
          <p className={styles.statsMetricValue}>{active.length}</p>
          <p className={styles.statsMetricLabel}>活跃卡片</p>
        </div>
      </div>

      <div className={styles.chartsGrid}>
        <ChartPanel
          title="列分布"
          icon="lucide:columns-3"
          hint="按列计数">
          <BarChart
            items={columnItems}
            isEmpty={isColumnEmpty}
            emptyHint="暂无卡片"
          />
        </ChartPanel>

        <ChartPanel
          title="优先级"
          icon="lucide:flag"
          hint="活跃卡">
          <BarChart
            items={priorityItems}
            isEmpty={isPriorityEmpty}
            emptyHint="暂无卡片"
          />
        </ChartPanel>

        <ChartPanel
          title="进度分布"
          icon="lucide:chart-column"
          hint="按清单完成度分桶">
          <BarChart
            items={progressBuckets}
            isEmpty={isProgressEmpty}
            emptyHint="暂无卡片"
          />
        </ChartPanel>
      </div>
    </div>
  )
}

export { StatsView }
