import { Icon } from '@iconify/react/offline'
import { clsx } from 'clsx'
import type { Dayjs } from 'dayjs'

import {
  STATUS_LABELS,
  type CountdownSnapshot,
  type WorkStatus
} from '@/features/magnetic-tiles/countdown/compute'
import styles from '@/views/countdown/countdown.module.scss'

const STATUS_ICON: Record<WorkStatus, string> = {
  before: 'mdi:briefcase-clock-outline',
  working: 'mdi:briefcase-check-outline',
  after: 'mdi:home-clock-outline',
  rest: 'mdi:beach'
}

interface CountdownPreviewProps {
  live: CountdownSnapshot
  now: Dayjs
  workRange: string
  monthlySalary: number
  paydayText: string
  footerStatus: string
  progressPct: number
}

function CountdownPreview(props: CountdownPreviewProps) {
  const { live } = props

  return (
    <div className={clsx(styles.preview, styles[live.status])}>
      <div className={styles.previewHero}>
        {props.monthlySalary > 0 ? (
          <div className={styles.previewMetric}>
            <span className={styles.previewLabel}>今日已赚</span>
            <span className={styles.previewEarn}>¥{live.todayEarned.toFixed(2)}</span>
          </div>
        ) : null}
        <div className={styles.previewMetric}>
          <span className={styles.previewLabel}>{STATUS_LABELS[live.status]}</span>
          <span className={styles.previewTime}>{live.countdown}</span>
        </div>
      </div>

      <div className={styles.previewFacts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>班次</span>
          <span className={styles.factValue}>{props.workRange}</span>
        </div>
        {props.monthlySalary > 0 ? (
          <>
            <div className={styles.fact}>
              <span className={styles.factLabel}>日薪</span>
              <span className={styles.factValue}>¥{live.dailySalary.toFixed(2)}</span>
            </div>
            <div className={styles.fact}>
              <span className={styles.factLabel}>距发薪</span>
              <span className={styles.factValue}>{props.paydayText}</span>
            </div>
          </>
        ) : (
          <div className={styles.fact}>
            <span className={styles.factLabel}>状态</span>
            <span className={styles.factValue}>{props.footerStatus}</span>
          </div>
        )}
      </div>

      <div className={styles.previewTrackWrap}>
        <div className={styles.previewTrackHead}>
          <span>班次进度</span>
          <span>{props.progressPct}%</span>
        </div>
        <div className={styles.previewTrack}>
          <div
            className={styles.previewFill}
            style={{ width: `${props.progressPct}%` }}
          />
        </div>
      </div>

      <div className={styles.previewBottom}>
        <span className={styles.previewStatus}>
          <Icon
            icon={STATUS_ICON[live.status]}
            width={14}
            height={14}
          />
          {props.footerStatus}
        </span>
        <span className={styles.previewRange}>{props.now.format('M月D日 ddd')}</span>
      </div>
    </div>
  )
}

export { CountdownPreview }
export type { CountdownPreviewProps }
