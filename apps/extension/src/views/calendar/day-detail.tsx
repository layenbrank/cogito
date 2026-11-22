import { Badge } from '@cogito/design/components/badge'
import { calendar, timeSphere } from '@cogito/utils'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'

import styles from '@/views/calendar/day-detail.module.scss'

type DayDetailProps = {
  date: Dayjs
}

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

function directionName(value: { toString(): string } | string): string {
  return typeof value === 'string' ? value : value.toString()
}

function DayDetail(props: DayDetailProps) {
  const { date } = props
  const key = timeSphere.format(date.toDate(), 'YYYY-MM-DD')
  const lunar = calendar.lunarDay(key)
  const cycle = calendar.sixtyCycle(key)
  const lunarText = calendar.format(key)
  const weekday = WEEKDAY_LABELS[date.day()]

  return (
    <section className={styles.root}>
      <header className={styles.hero}>
        <div className={styles.dayNum}>{date.date()}</div>
        <div className={styles.heroMain}>
          <div className={styles.solar}>
            {key}
            <span className={styles.weekday}>周{weekday}</span>
            {lunar.festival ? <Badge>{lunar.festival}</Badge> : null}
          </div>
          <div className={styles.lunar}>
            {lunarText}
            <span className={styles.sep}>·</span>
            {cycle.heavenStem}
            {cycle.earthBranch}
            {cycle.zodiac}年
          </div>
        </div>
      </header>

      <div className={styles.panel}>
        <div className={styles.panelTitle}>黄历</div>
        <div className={styles.chips}>
          <Badge variant="secondary">生肖 {lunar.zodiac}</Badge>
          <Badge variant="secondary">星座 {lunar.constellation}</Badge>
          {lunar.phase ? <Badge variant="secondary">{lunar.phase}</Badge> : null}
        </div>

        <div className={styles.yiJi}>
          <div className={styles.yiJiCard}>
            <div className={clsx(styles.yiJiLabel, styles.yi)}>宜</div>
            <div className={styles.yiJiBody}>{lunar.beneficial || '—'}</div>
          </div>
          <div className={styles.yiJiCard}>
            <div className={clsx(styles.yiJiLabel, styles.ji)}>忌</div>
            <div className={styles.yiJiBody}>{lunar.unbeneficial || '—'}</div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>物候</span>
            <span className={styles.metaValue}>{lunar.phenologyDay || '—'}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>喜神</span>
            <span className={styles.metaValue}>{directionName(lunar.directions.joyDirection)}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>财神</span>
            <span className={styles.metaValue}>
              {directionName(lunar.directions.wealthDirection)}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>福神</span>
            <span className={styles.metaValue}>
              {directionName(lunar.directions.mascotDirection)}
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

export { DayDetail }
export type { DayDetailProps }
