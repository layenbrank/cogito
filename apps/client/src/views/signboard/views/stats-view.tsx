import { useMemo, useState } from 'react'

import type { SignboardEntry, SignboardColumn } from '@/stores/signboard'
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
  const active = useMemo(
    function () {
      return props.entries.filter(function (card) {
        return card.archivedAt === null || card.archivedAt === undefined
      })
    },
    [props.entries]
  )

  const columnCounts = useMemo(
    function () {
      return props.columns.map(function (column) {
        const count = active.filter(function (card) {
          return card.columnID === column.id
        }).length
        return { column, count }
      })
    },
    [props.columns, active]
  )

  const maxColumn = Math.max(
    1,
    ...columnCounts.map(function (row) {
      return row.count
    })
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

  const priorityBuckets = useMemo(
    function () {
      const buckets = [0, 0, 0, 0, 0]
      for (const card of active) {
        const idx = Math.min(Math.max(card.priority, 0), 4)
        buckets[idx] = (buckets[idx] ?? 0) + 1
      }
      return buckets
    },
    [active]
  )

  const maxPriority = Math.max(1, ...priorityBuckets)

  return (
    <div className={styles.paneView}>
      <div className={styles.statsGrid}>
        <section className={styles.statsCard}>
          <h3 className={styles.statsTitle}>概览</h3>
          <div className={styles.statsMetrics}>
            <div>
              <p className={styles.statsMetricValue}>{active.length}</p>
              <p className={styles.statsMetricLabel}>活跃卡片</p>
            </div>
            <div>
              <p className={styles.statsMetricValue}>{overdue}</p>
              <p className={styles.statsMetricLabel}>已逾期</p>
            </div>
            <div>
              <p className={styles.statsMetricValue}>{dueThisWeek}</p>
              <p className={styles.statsMetricLabel}>本周到期</p>
            </div>
          </div>
        </section>

        <section className={styles.statsCard}>
          <h3 className={styles.statsTitle}>列分布</h3>
          <ul className={styles.statsBars}>
            {columnCounts.map(function (row) {
              const pct = (row.count / maxColumn) * 100
              return (
                <li key={row.column.id}>
                  <div className={styles.statsBarLabel}>
                    <span>{row.column.title}</span>
                    <span>{row.count}</span>
                  </div>
                  <div className={styles.statsBarTrack}>
                    <div
                      className={styles.statsBarFill}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        <section className={styles.statsCard}>
          <h3 className={styles.statsTitle}>优先级</h3>
          <ul className={styles.statsBars}>
            {priorityBuckets.map(function (count, index) {
              const pct = (count / maxPriority) * 100
              return (
                <li key={PRIORITY_LABELS[index]}>
                  <div className={styles.statsBarLabel}>
                    <span>{PRIORITY_LABELS[index]}</span>
                    <span>{count}</span>
                  </div>
                  <div className={styles.statsBarTrack}>
                    <div
                      className={styles.statsBarFillAlt}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}

export { StatsView }
