import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { useMemo, useState } from 'react'

import { useSignboardStore, type SignboardEntry } from '@/stores/signboard'
import { findChecklistProgress } from '@/views/signboard/progress'
import styles from '@/views/signboard/signboard.module.scss'

interface CalendarViewProps {
  entries: SignboardEntry[]
  onOpenCard: (entryID: string) => void
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1)
}

function dayKey(ms: number) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function CalendarView(props: CalendarViewProps) {
  const checksForEntry = useSignboardStore(function (state) {
    return state.checksForEntry
  })
  const [cursor, setCursor] = useState(function () {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })

  const undated = useMemo(
    function () {
      return props.entries.filter(function (card) {
        return (
          (card.archivedAt === null || card.archivedAt === undefined) &&
          (card.dueAt === null || card.dueAt === undefined)
        )
      })
    },
    [props.entries]
  )

  const byDay = useMemo(
    function () {
      const map = new Map<string, SignboardEntry[]>()
      for (const card of props.entries) {
        if (
          (card.archivedAt !== null && card.archivedAt !== undefined) ||
          card.dueAt === null ||
          card.dueAt === undefined
        )
          continue
        const key = dayKey(card.dueAt)
        const bucket = map.get(key) ?? []
        bucket.push(card)
        map.set(key, bucket)
      }
      return map
    },
    [props.entries]
  )

  const cells = useMemo(
    function () {
      const first = startOfMonth(cursor.year, cursor.month)
      const startPad = first.getDay()
      const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate()
      const total = Math.ceil((startPad + daysInMonth) / 7) * 7
      const result: { date: Date | null; key: string }[] = []
      for (let i = 0; i < total; i++) {
        const day = i - startPad + 1
        if (day < 1 || day > daysInMonth) {
          result.push({ date: null, key: `empty-${i}` })
          continue
        }
        const date = new Date(cursor.year, cursor.month, day)
        result.push({
          date,
          key: `${cursor.year}-${cursor.month}-${day}`
        })
      }
      return result
    },
    [cursor]
  )

  function shiftMonth(delta: number) {
    setCursor(function (prev) {
      const date = new Date(prev.year, prev.month + delta, 1)
      return { year: date.getFullYear(), month: date.getMonth() }
    })
  }

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`

  return (
    <div className={styles.paneView}>
      <div className={styles.calendarLayout}>
        <div className={styles.calendarMain}>
          <div className={styles.calendarToolbar}>
            <Button
              type="button"
              size="icon-lg"
              variant="ghost"
              aria-label="上一月"
              onClick={function () {
                shiftMonth(-1)
              }}>
              <Icon
                icon="lucide:chevron-left"
                className="size-4"
              />
            </Button>
            <h3 className={styles.calendarTitle}>
              {cursor.year} 年 {cursor.month + 1} 月
            </h3>
            <Button
              type="button"
              size="icon-lg"
              variant="ghost"
              aria-label="下一月"
              onClick={function () {
                shiftMonth(1)
              }}>
              <Icon
                icon="lucide:chevron-right"
                className="size-4"
              />
            </Button>
          </div>
          <div className={styles.calendarGrid}>
            {WEEKDAYS.map(function (label) {
              return (
                <div
                  key={label}
                  className={styles.calendarWeekday}>
                  {label}
                </div>
              )
            })}
            {cells.map(function (cell) {
              if (!cell.date) {
                return (
                  <div
                    key={cell.key}
                    className={styles.calendarCellEmpty}
                  />
                )
              }
              const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
              const dayCards = byDay.get(key) ?? []
              const isToday = key === todayKey
              return (
                <div
                  key={cell.key}
                  className={isToday ? styles.calendarCellToday : styles.calendarCell}>
                  <span className={styles.calendarDayNum}>{cell.date.getDate()}</span>
                  <ul className={styles.calendarEvents}>
                    {dayCards.slice(0, 3).map(function (card) {
                      const checklist = findChecklistProgress(checksForEntry(card.id))
                      return (
                        <li key={card.id}>
                          <button
                            type="button"
                            className={styles.calendarEvent}
                            onClick={function () {
                              props.onOpenCard(card.id)
                            }}>
                            <span className="truncate">{card.title}</span>
                            <span className={styles.calendarEventMeta}>
                              {checklist.done}/{checklist.total}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                    {dayCards.length > 3 ? (
                      <li className={styles.calendarMore}>+{dayCards.length - 3}</li>
                    ) : null}
                  </ul>
                </div>
              )
            })}
          </div>
        </div>
        <aside className={styles.calendarSide}>
          <p className={styles.ganttSideTitle}>无日期</p>
          {undated.length === 0 ? (
            <p className={styles.paneEmpty}>全部卡片都有到期日</p>
          ) : (
            <ul className={styles.ganttSideList}>
              {undated.map(function (card) {
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
          )}
        </aside>
      </div>
    </div>
  )
}

export { CalendarView }
