import { useMemo } from 'react'

import type { SignboardEntry, SignboardColumn } from '@/stores/signboard'
import styles from '@/views/signboard/signboard.module.scss'

interface GanttViewProps {
  columns: SignboardColumn[]
  entries: SignboardEntry[]
  onOpenCard: (entryID: string) => void
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_SPAN_DAYS = 7

function startOfDay(ms: number) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function cardRange(card: SignboardEntry) {
  const start = startOfDay(card.startAt ?? card.createdAt)
  const end =
    card.dueAt != null
      ? startOfDay(card.dueAt) + DAY_MS
      : start + DEFAULT_SPAN_DAYS * DAY_MS
  return { start, end: Math.max(end, start + DAY_MS) }
}

function formatDay(ms: number) {
  const date = new Date(ms)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function GanttView(props: GanttViewProps) {
  const activeCards = useMemo(
    function () {
      return props.entries.filter(function (card) {
        return card.archivedAt == null
      })
    },
    [props.entries]
  )

  const scheduled = useMemo(
    function () {
      return activeCards.filter(function (card) {
        return card.startAt != null || card.dueAt != null
      })
    },
    [activeCards]
  )

  const unscheduled = useMemo(
    function () {
      return activeCards.filter(function (card) {
        return card.startAt == null && card.dueAt == null
      })
    },
    [activeCards]
  )

  const { rangeStart, days } = useMemo(
    function () {
      if (scheduled.length === 0) {
        const today = startOfDay(Date.now())
        return {
          rangeStart: today,
          days: Array.from({ length: 14 }, function (_, i) {
            return today + i * DAY_MS
          })
        }
      }
      let min = Infinity
      let max = -Infinity
      for (const card of scheduled) {
        const range = cardRange(card)
        min = Math.min(min, range.start)
        max = Math.max(max, range.end)
      }
      const start = startOfDay(min - DAY_MS)
      const end = startOfDay(max + DAY_MS)
      const count = Math.max(7, Math.ceil((end - start) / DAY_MS) + 1)
      return {
        rangeStart: start,
        days: Array.from({ length: Math.min(count, 42) }, function (_, i) {
          return start + i * DAY_MS
        })
      }
    },
    [scheduled]
  )

  const columnTitle = useMemo(
    function () {
      const map = new Map<string, string>()
      for (const column of props.columns) {
        map.set(column.id, column.title)
      }
      return map
    },
    [props.columns]
  )

  const totalWidth = days.length * 36

  return (
    <div className={styles.paneView}>
      <div className={styles.ganttLayout}>
        <div className={styles.ganttMain}>
          <div
            className={styles.ganttScroll}
            style={{ minWidth: totalWidth + 160 }}>
            <div
              className={styles.ganttHeader}
              style={{ gridTemplateColumns: `160px repeat(${days.length}, 36px)` }}>
              <div className={styles.ganttCorner}>卡片</div>
              {days.map(function (day) {
                return (
                  <div
                    key={day}
                    className={styles.ganttDay}>
                    {formatDay(day)}
                  </div>
                )
              })}
            </div>
            {scheduled.map(function (card) {
              const range = cardRange(card)
              const left = ((range.start - rangeStart) / DAY_MS) * 36
              const width = Math.max(((range.end - range.start) / DAY_MS) * 36, 24)
              return (
                <div
                  key={card.id}
                  className={styles.ganttRow}
                  style={{ gridTemplateColumns: `160px ${totalWidth}px` }}>
                  <button
                    type="button"
                    className={styles.ganttLabel}
                    onClick={function () {
                      props.onOpenCard(card.id)
                    }}>
                    <span className={styles.ganttLabelTitle}>{card.title}</span>
                    <span className={styles.ganttLabelMeta}>
                      {columnTitle.get(card.columnID) ?? ''}
                    </span>
                  </button>
                  <div className={styles.ganttTrack}>
                    <button
                      type="button"
                      className={styles.ganttBar}
                      style={{ left, width }}
                      title={card.title}
                      onClick={function () {
                        props.onOpenCard(card.id)
                      }}
                    />
                  </div>
                </div>
              )
            })}
            {scheduled.length === 0 ? (
              <p className={styles.paneEmpty}>设置开始日或到期日后会出现在甘特图中</p>
            ) : null}
          </div>
        </div>
        {unscheduled.length > 0 ? (
          <aside className={styles.ganttSide}>
            <p className={styles.ganttSideTitle}>未排期</p>
            <ul className={styles.ganttSideList}>
              {unscheduled.map(function (card) {
                return (
                  <li key={card.id}>
                    <button
                      type="button"
                      className={styles.ganttSideItem}
                      onClick={function () {
                        props.onOpenCard(card.id)
                      }}>
                      {card.title}
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

export { GanttView }
