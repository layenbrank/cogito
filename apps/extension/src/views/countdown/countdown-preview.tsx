import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
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
    <div className={cn('mt-pane-preview', styles.preview, styles[live.status])}>
      <div className={styles.previewHero}>
        <div className={styles.previewMetric}>
          <span className="mt-preview-label">{STATUS_LABELS[live.status]}</span>
          <span className={styles.previewTime}>{live.countdown}</span>
        </div>
        {props.monthlySalary > 0 ? (
          <div className={styles.previewMetricSecondary}>
            <span className="mt-preview-label">今日已赚</span>
            <span className={styles.previewEarn}>¥{live.todayEarned.toFixed(2)}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.previewFacts}>
        <div className="mt-fact">
          <span className="mt-fact-label">班次</span>
          <span className="mt-fact-value">{props.workRange}</span>
        </div>
        {props.monthlySalary > 0 ? (
          <>
            <div className="mt-fact">
              <span className="mt-fact-label">日薪</span>
              <span className="mt-fact-value">¥{live.dailySalary.toFixed(2)}</span>
            </div>
            <div className="mt-fact">
              <span className="mt-fact-label">距发薪</span>
              <span className="mt-fact-value">{props.paydayText}</span>
            </div>
          </>
        ) : (
          <div className="mt-fact">
            <span className="mt-fact-label">状态</span>
            <span className="mt-fact-value">{props.footerStatus}</span>
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

      <div className="mt-preview-bottom">
        <span className="mt-preview-status">
          <Icon
            icon={STATUS_ICON[live.status]}
            width={14}
            height={14}
          />
          {props.footerStatus}
        </span>
        <span className="mt-preview-range">{props.now.format('M月D日 ddd')}</span>
      </div>
    </div>
  )
}

export { CountdownPreview }
export type { CountdownPreviewProps }
