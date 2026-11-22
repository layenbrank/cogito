import { Icon } from '@iconify/react/offline'
import type { Dayjs } from 'dayjs'

import styles from './marker.module.scss'

interface CountdownMarkerSurfacesProps {
  showPayday: boolean
  showSalaryDetail: boolean
  showDate: boolean
  isPayday: boolean
  daysUntilPayday: number
  paydayDate: string
  todayEarned: number
  monthlySalary: number
  dailySalary: number
  now: Dayjs
}

function CountdownMarkerSurfaces(props: CountdownMarkerSurfacesProps) {
  if (!props.showPayday && !props.showSalaryDetail && !props.showDate) return null

  return (
    <div className={styles.surfaces}>
      {props.showPayday ? (
        <div className={styles.panel}>
          <span className={styles.panelLabel}>
            <Icon
              icon="mdi:calendar-star"
              width="1em"
              height="1em"
            />
            发薪日
          </span>
          {props.isPayday ? (
            <span className={styles.panelHero}>今天发薪</span>
          ) : (
            <>
              <span className={styles.panelHero}>
                {props.daysUntilPayday}
                <span className={styles.panelUnit}>天</span>
              </span>
              <span className={styles.panelSub}>{props.paydayDate} 发薪</span>
            </>
          )}
        </div>
      ) : null}

      {props.showSalaryDetail ? (
        <div className={styles.panel}>
          <span className={styles.panelLabel}>
            <Icon
              icon="mdi:cash-clock"
              width="1em"
              height="1em"
            />
            薪酬
          </span>
          <span className={styles.panelHero}>¥{props.todayEarned.toFixed(2)}</span>
          <span className={styles.panelSub}>
            月薪 ¥{props.monthlySalary.toLocaleString()} · 日薪 ¥
            {props.dailySalary.toFixed(2)}
          </span>
        </div>
      ) : null}

      {props.showDate ? (
        <div className={styles.panel}>
          <span className={styles.panelLabel}>
            <Icon
              icon="mdi:calendar-outline"
              width="1em"
              height="1em"
            />
            今日
          </span>
          <span className={styles.panelHero}>{props.now.format('M月D日')}</span>
          <span className={styles.panelSub}>{props.now.format('dddd')}</span>
        </div>
      ) : null}
    </div>
  )
}

export { CountdownMarkerSurfaces }
