import { Icon } from '@iconify/react/offline'
import clsx from 'clsx'

import { STATUS_ICON } from './constants'
import styles from './marker.module.scss'
import type { WorkStatus } from '@/features/magnetic-tiles/countdown/compute'

interface CountdownMarkerCompactProps {
  wide: boolean
  status: WorkStatus
  stripText: string
  progressPct: number
}

function CountdownMarkerCompact(props: CountdownMarkerCompactProps) {
  if (props.wide) {
    return (
      <div className={styles.stripBody}>
        <span className={clsx(styles.iconWell, styles.iconWellSm, styles.iconWellPrimary)}>
          <Icon
            icon={STATUS_ICON[props.status]}
            width="1em"
            height="1em"
          />
        </span>
        <span className={styles.stripTime}>{props.stripText}</span>
        <div className={styles.stripTrack}>
          <div
            className={styles.stripFill}
            style={{ width: `${props.progressPct}%` }}
          />
        </div>
        <span className={styles.stripPct}>{props.progressPct}%</span>
      </div>
    )
  }

  return (
    <div className={styles.compactBody}>
      <span className={clsx(styles.iconWell, styles.iconWellPrimary)}>
        <Icon
          icon={STATUS_ICON[props.status]}
          className={styles.compactIcon}
          width="1em"
          height="1em"
        />
      </span>
      <span className={styles.compactTime}>{props.stripText}</span>
      <div className={styles.compactTrack}>
        <div
          className={styles.compactFill}
          style={{ width: `${props.progressPct}%` }}
        />
      </div>
    </div>
  )
}

export { CountdownMarkerCompact }
