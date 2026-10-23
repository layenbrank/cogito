import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { calendar, timeSphere } from '@cogito/utils'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { MagneticTile, type MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { findCapacity, isWide, markerClass, type Capacity } from '@/features/magnetic-tile/marker'
import styles from '@/features/magnetic-tiles/calendar/marker.module.scss'
import { useCalendarStore } from '@/stores/calendar'
import { useReminderStore } from '@/stores/reminder'

type Props = Omit<MarkerProps, 'children'>

type DayInfo = {
  weekday: string
  day: string
  monthLabel: string
  yearMonth: string
  lunar: string
  holiday: string | null
  term: string | null
  ganZhi: string
  zodiac: string
  constellation: string
  phase: string
  beneficial: string
  unbeneficial: string
  phenology: string
  gods: string
  iso: string
}

type VisibleFields = {
  showFullYearMonth: boolean
  showLunar: boolean
  showHoliday: boolean
  showTermExtra: boolean
  showGanZhi: boolean
  showConstellation: boolean
  showYiJi: boolean
  showPhase: boolean
  showIso: boolean
  showPhenology: boolean
  showGods: boolean
  showChips: boolean
  showAgenda: boolean
  agendaLimit: number
}

type AgendaItem = {
  id: string
  kind: 'event' | 'reminder'
  title: string
  timeLabel: string
  sortAt: number
  isCompleted?: boolean
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'] as const

function isTall(shape: MagneticTile.Shape, direction: MagneticTile.Direction) {
  return shape === 'rectangle' && direction === 'vertical'
}

function truncateItems(text: string, max: number) {
  if (!text) return ''
  const parts = text.split('、').filter(Boolean)
  if (parts.length <= max) return parts.join('、')
  return `${parts.slice(0, max).join('、')}…`
}

function directionLabel(value: { toString(): string } | string) {
  return typeof value === 'string' ? value : value.toString()
}

function formatTimeLabel(ms: number, entireDay: boolean) {
  if (entireDay) return '全天'
  const date = new Date(ms)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function dayBounds(date: Dayjs) {
  const start = date.startOf('day')
  return {
    from: start.valueOf(),
    to: start.add(1, 'day').valueOf()
  }
}

function findDayInfo(now: Dayjs): DayInfo {
  const key = timeSphere.format(now.toDate(), 'YYYY-MM-DD')
  const cycle = calendar.sixtyCycle(key)
  const lunarDay = calendar.lunarDay(key)
  const legal = calendar.legalHoliday(key)?.name ?? null
  const festival = calendar.festival(key)
  const term = calendar.term(key)
  const holiday = legal ?? festival ?? term
  const lunarMonth = calendar.format(key, 'lM')
  const lunarDayText = calendar.format(key, 'lD')

  return {
    weekday: `周${WEEK[now.day()]}`,
    day: now.format('D'),
    monthLabel: `${now.format('M')}月`,
    yearMonth: now.format('YYYY-MM'),
    lunar: `农历${lunarMonth}${lunarDayText}`,
    holiday,
    term: term && term !== holiday ? term : null,
    ganZhi: `${cycle.heavenStem}${cycle.earthBranch}${cycle.zodiac}年`,
    zodiac: lunarDay.zodiac,
    constellation: lunarDay.constellation,
    phase: lunarDay.phase || '',
    beneficial: lunarDay.beneficial || '',
    unbeneficial: lunarDay.unbeneficial || '',
    phenology: lunarDay.phenologyDay || '',
    gods: `喜${directionLabel(lunarDay.directions.joyDirection)} · 财${directionLabel(lunarDay.directions.wealthDirection)}`,
    iso: key
  }
}

function findVisibleFields(capacity: Capacity, mode: 'wide' | 'tall' | 'stack'): VisibleFields {
  // 非 wide 提前一档展示，吃满空间；wide 保持 size2 定稿门槛
  const boost = mode === 'wide' ? 1 : 2
  const dense = capacity + boost
  const isWideMode = mode === 'wide'

  return {
    showFullYearMonth: isWideMode ? capacity >= 3 : capacity >= 2,
    showLunar: capacity >= 2,
    showHoliday: isWideMode ? capacity >= 3 : capacity >= 2,
    showTermExtra: dense >= 4,
    showGanZhi: isWideMode ? capacity >= 3 : capacity >= 2,
    showConstellation: dense >= 4,
    showPhase: dense >= 4,
    // 方块 size2 高度紧，宜忌让给农历/chips；size3+ 再展开
    showYiJi: isWideMode ? dense >= 4 : capacity >= 3,
    showChips: dense >= 4,
    showPhenology: dense >= 5,
    showGods: dense >= 6,
    showIso: dense >= 7,
    showAgenda: isWideMode ? capacity >= 3 : capacity >= 2,
    agendaLimit: isWideMode
      ? Math.min(5, Math.max(2, capacity))
      : mode === 'tall'
        ? Math.min(8, Math.max(3, capacity + 2))
        : Math.min(5, Math.max(2, capacity + 1))
  }
}

function findYiJiMax(capacity: Capacity) {
  if (capacity >= 5) return 4
  if (capacity >= 3) return 3
  return 2
}

/** 文本提示：无提示内容时退化为纯文本，避免空浮层 */
function Hint(props: {
  hint: string
  side?: 'top' | 'bottom'
  className: string
  children: ReactNode
}) {
  if (!props.hint) return <span className={props.className}>{props.children}</span>

  return (
    <Tooltip>
      <TooltipTrigger render={<span className={props.className} />}>
        {props.children}
      </TooltipTrigger>
      <TooltipContent side={props.side ?? 'top'}>{props.hint}</TooltipContent>
    </Tooltip>
  )
}

function ChipRow(props: { dayInfo: DayInfo; fields: VisibleFields }) {
  const { dayInfo, fields } = props
  if (!fields.showChips) return null

  const chips: string[] = []
  if (fields.showConstellation && dayInfo.constellation) chips.push(dayInfo.constellation)
  if (fields.showPhase && dayInfo.phase) chips.push(dayInfo.phase)
  if (fields.showPhenology && dayInfo.phenology) chips.push(dayInfo.phenology)
  if (fields.showTermExtra && dayInfo.term) chips.push(dayInfo.term)
  if (chips.length === 0 && dayInfo.zodiac) chips.push(`属${dayInfo.zodiac}`)
  if (chips.length === 0) return null

  return (
    <div className={styles.chipRow}>
      {chips.map(function (text) {
        return (
          <span
            key={text}
            className={styles.chip}>
            {text}
          </span>
        )
      })}
    </div>
  )
}

function YiJiBlock(props: { dayInfo: DayInfo; maxItems: number }) {
  const { dayInfo, maxItems } = props
  const yiText = truncateItems(dayInfo.beneficial, maxItems) || '—'
  const jiText = truncateItems(dayInfo.unbeneficial, maxItems) || '—'

  return (
    <div className={styles.yiJiInline}>
      <Hint
        hint={dayInfo.beneficial}
        side="bottom"
        className={styles.yiLine}>
        <span className={styles.yiJiLabel}>宜</span>
        <span className={styles.yiJiBody}>{yiText}</span>
      </Hint>
      <Hint
        hint={dayInfo.unbeneficial}
        side="bottom"
        className={styles.jiLine}>
        <span className={styles.jiLabel}>忌</span>
        <span className={styles.yiJiBody}>{jiText}</span>
      </Hint>
    </div>
  )
}

function AgendaPanel(props: { items: AgendaItem[]; limit: number }) {
  const { items, limit } = props
  const visible = items.slice(0, limit)
  const rest = items.length - visible.length

  return (
    <aside className={styles.agenda}>
      <div className={styles.agendaHead}>
        <span className={styles.agendaTitle}>今日日程</span>
        <span className={styles.agendaCount}>{items.length}</span>
      </div>
      {visible.length === 0 ? (
        <div className={styles.agendaEmpty}>暂无提醒或事件</div>
      ) : (
        <ul className={styles.agendaList}>
          {visible.map(function (item) {
            return (
              <li
                key={`${item.kind}-${item.id}`}
                className={styles.agendaItem}>
                <span
                  className={
                    item.kind === 'reminder' ? styles.agendaDotReminder : styles.agendaDotEvent
                  }
                />
                <span className={styles.agendaTime}>{item.timeLabel}</span>
                <Hint
                  hint={item.title}
                  className={item.isCompleted ? styles.agendaTextDone : styles.agendaText}>
                  {item.title}
                </Hint>
              </li>
            )
          })}
        </ul>
      )}
      {rest > 0 ? <div className={styles.agendaMore}>还有 {rest} 项</div> : null}
    </aside>
  )
}

function InfoBlock(props: {
  dayInfo: DayInfo
  fields: VisibleFields
  dateLine: string
  holidayLabel: string | null
  yiJiMax: number
}) {
  const { dayInfo, fields, dateLine, holidayLabel, yiJiMax } = props

  return (
    <div className={styles.infoRail}>
      <div className={styles.infoTop}>
        <span className={styles.ymd}>{dateLine}</span>
        {holidayLabel ? <span className={styles.holidayTag}>{holidayLabel}</span> : null}
      </div>
      {fields.showLunar || fields.showGanZhi ? (
        <div className={styles.infoSub}>
          {fields.showLunar ? (
            <Hint
              hint={dayInfo.lunar}
              className={styles.lunar}>
              {dayInfo.lunar}
            </Hint>
          ) : null}
          {fields.showLunar && fields.showGanZhi ? <span className={styles.dotSep}>·</span> : null}
          {fields.showGanZhi ? <span className={styles.ganzhi}>{dayInfo.ganZhi}</span> : null}
        </div>
      ) : null}
      <ChipRow
        dayInfo={dayInfo}
        fields={fields}
      />
      {fields.showGods ? <span className={styles.gods}>{dayInfo.gods}</span> : null}
      {fields.showIso ? <span className={styles.iso}>{dayInfo.iso}</span> : null}
      {fields.showYiJi ? (
        <YiJiBlock
          dayInfo={dayInfo}
          maxItems={yiJiMax}
        />
      ) : null}
    </div>
  )
}

function DayRail(props: { day: string; weekday: string }) {
  return (
    <div className={styles.dayRail}>
      <span className={styles.bigDay}>{props.day}</span>
      <span className={styles.dayRailWeek}>{props.weekday}</span>
    </div>
  )
}

function Marker(props: Props) {
  const [now, onUpdateNow] = useState(function () {
    return dayjs()
  })

  const events = useCalendarStore(function (state) {
    return state.events
  })
  const reminders = useReminderStore(function (state) {
    return state.reminders
  })
  const toReadEvents = useCalendarStore(function (state) {
    return state.toReadEvents
  })
  const toReadReminders = useReminderStore(function (state) {
    return state.toReadReminders
  })

  useEffect(function () {
    const timer = setInterval(function () {
      onUpdateNow(dayjs())
    }, 60_000)
    return function () {
      clearInterval(timer)
    }
  }, [])

  useEffect(
    function () {
      const range = dayBounds(now)
      void Promise.all([
        toReadEvents({ rangeFrom: range.from, rangeTo: range.to }),
        toReadReminders({ dueFrom: range.from, dueTo: range.to })
      ])
    },
    // 按自然日刷新当日日程
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now.format('YYYY-MM-DD'), toReadEvents, toReadReminders]
  )

  const capacity = findCapacity(props.size, props.shape, props.direction)
  const wide = isWide(props.shape, props.direction)
  const tall = isTall(props.shape, props.direction)
  const layoutMode = wide ? 'wide' : tall ? 'tall' : 'stack'
  const isCompact = capacity <= 1
  const dayInfo = useMemo(
    function () {
      return findDayInfo(now)
    },
    [now]
  )
  const fields = findVisibleFields(capacity, layoutMode)
  const dateLine = fields.showFullYearMonth ? dayInfo.yearMonth : dayInfo.monthLabel
  const holidayLabel = fields.showHoliday && dayInfo.holiday ? dayInfo.holiday : null
  const yiJiMax = findYiJiMax(capacity)

  const agendaItems = useMemo(
    function () {
      const range = dayBounds(now)
      const eventItems: AgendaItem[] = events
        .filter(function (event) {
          return event.endAt >= range.from && event.startAt < range.to
        })
        .map(function (event) {
          return {
            id: event.id,
            kind: 'event',
            title: event.title,
            timeLabel: formatTimeLabel(event.startAt, event.entireDay),
            sortAt: event.startAt
          }
        })
      const reminderItems: AgendaItem[] = reminders
        .filter(function (reminder) {
          return (
            reminder.dueAt !== null &&
            reminder.dueAt !== undefined &&
            reminder.dueAt >= range.from &&
            reminder.dueAt < range.to
          )
        })
        .map(function (reminder) {
          return {
            id: reminder.id,
            kind: 'reminder',
            title: reminder.title,
            timeLabel: formatTimeLabel(reminder.dueAt ?? 0, reminder.entireDay),
            sortAt: reminder.dueAt ?? 0,
            isCompleted: reminder.archivedAt !== null && reminder.archivedAt !== undefined
          }
        })
      return [...eventItems, ...reminderItems].sort(function (a, b) {
        return a.sortAt - b.sortAt
      })
    },
    [events, reminders, now]
  )

  const showAgenda = fields.showAgenda

  return (
    <MagneticTile.Marker
      {...props}
      className={markerClass(
        styles,
        props.size,
        props.shape,
        props.direction,
        isCompact ? styles.compact : styles.expanded,
        wide && styles.wide,
        tall && styles.tall,
        showAgenda && styles.withAgenda
      )}>
      {isCompact ? (
        <div className={styles.compactBody}>
          <span className={styles.weekday}>{dayInfo.weekday}</span>
          <span className={styles.day}>{dayInfo.day}</span>
          <span className={styles.month}>{dayInfo.monthLabel}</span>
        </div>
      ) : (
        <div className={styles.expandedBody}>
          <div className={styles.mainPane}>
            <DayRail
              day={dayInfo.day}
              weekday={dayInfo.weekday}
            />
            <InfoBlock
              dayInfo={dayInfo}
              fields={fields}
              dateLine={dateLine}
              holidayLabel={holidayLabel}
              yiJiMax={yiJiMax}
            />
          </div>
          {showAgenda ? (
            <AgendaPanel
              items={agendaItems}
              limit={fields.agendaLimit}
            />
          ) : null}
        </div>
      )}
    </MagneticTile.Marker>
  )
}

export default Marker
