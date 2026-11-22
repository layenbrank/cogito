import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'
import type { Dayjs } from 'dayjs'

import { METRIC_ICON, STATUS_ICON } from './constants'
import { CountdownMarkerSurfaces } from './surfaces'
import styles from './marker.module.scss'
import type { WorkStatus } from '@/features/magnetic-tiles/countdown/compute'

interface CountdownMarkerExpandedProps {
  showDecor: boolean
  showEarn: boolean
  showTrack: boolean
  showFooter: boolean
  showPayday: boolean
  showSalaryDetail: boolean
  showDate: boolean
  status: WorkStatus
  progressPct: number
  progressTitle: string
  footerStatus: string
  workRange: string
  metricLabel: string
  metricValue: string
  metricIcon: (typeof METRIC_ICON)[keyof typeof METRIC_ICON]
  isMetricDim: boolean
  todayEarned: number
  monthlySalary: number
  dailySalary: number
  isPayday: boolean
  daysUntilPayday: number
  paydayDate: string
  now: Dayjs
}

function CountdownMarkerExpanded(props: CountdownMarkerExpandedProps) {
  return (
    <div className={styles.expandedBody}>
      {props.showDecor ? (
        <div
          className={styles.decor}
          aria-hidden>
          <Icon
            icon={METRIC_ICON.decor}
            width="1em"
            height="1em"
          />
        </div>
      ) : null}

      <div className={styles.row}>
        {props.showEarn ? (
          <div className={clsx(styles.col, styles.earn)}>
            <div className={styles.metricHead}>
              <span className={clsx(styles.iconWell, styles.iconWellSuccess)}>
                <Icon
                  icon={METRIC_ICON.earn}
                  width="1em"
                  height="1em"
                />
              </span>
              <span className={styles.label}>今日已赚</span>
            </div>
            <span className={styles.value}>¥{props.todayEarned.toFixed(2)}</span>
          </div>
        ) : null}
        <div className={styles.col}>
          <div className={styles.metricHead}>
            <span className={clsx(styles.iconWell, styles.iconWellPrimary)}>
              <Icon
                icon={props.metricIcon}
                width="1em"
                height="1em"
              />
            </span>
            <span className={styles.label}>{props.metricLabel}</span>
          </div>
          <span className={clsx(styles.value, props.isMetricDim && styles.valueDim)}>
            {props.metricValue}
          </span>
        </div>
      </div>

      {props.showTrack ? (
        <div className={styles.progress}>
          <div className={styles.progressHead}>
            <span className={styles.progressTitle}>
              <Icon
                icon={METRIC_ICON.progress}
                className={styles.inlineIcon}
                width="1em"
                height="1em"
              />
              {props.progressTitle}
            </span>
            <span className={styles.progressLabel}>{props.progressPct}%</span>
          </div>
          <div className={styles.track}>
            <div
              className={styles.fill}
              style={{ width: `${props.progressPct}%` }}
            />
          </div>
        </div>
      ) : null}

      {props.showFooter ? (
        <div className={styles.footer}>
          <span className={styles.status}>
            <span className={clsx(styles.iconWell, styles.iconWellSm, styles.iconWellStatus)}>
              <Icon
                icon={STATUS_ICON[props.status]}
                width="1em"
                height="1em"
              />
            </span>
            {props.footerStatus}
          </span>
          <span className={styles.range}>
            <Icon
              icon={METRIC_ICON.shift}
              className={styles.inlineIcon}
              width="1em"
              height="1em"
            />
            {props.workRange}
          </span>
        </div>
      ) : null}

      <CountdownMarkerSurfaces
        showPayday={props.showPayday}
        showSalaryDetail={props.showSalaryDetail}
        showDate={props.showDate}
        isPayday={props.isPayday}
        daysUntilPayday={props.daysUntilPayday}
        paydayDate={props.paydayDate}
        todayEarned={props.todayEarned}
        monthlySalary={props.monthlySalary}
        dailySalary={props.dailySalary}
        now={props.now}
      />
    </div>
  )
}

export { CountdownMarkerExpanded }
