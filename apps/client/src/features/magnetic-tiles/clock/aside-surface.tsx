import clsx from 'clsx'
import styles from './aside.module.scss'

interface AsideSurfaceProps {
  period: string
  dateLabel: string
  weekday: string
  weekOfYear: number
  showPeriod: boolean
  showWeek: boolean
  showNextAlarm: boolean
  showAlarmSummary: boolean
  nextReminders: Array<{ reminder: { id: string; fireTime: string | null; title?: string } }>
  todayEnabled: number
  enabledTotal: number
  className?: string
  isNeon?: boolean
  wide?: boolean
}

export function AsideSurface(props: AsideSurfaceProps) {
  return (
    <aside className={clsx(styles.aside, props.isNeon && styles.neon, props.wide && styles.wide, props.className)}>
      <div className={styles.metaBlock}>
        {props.showPeriod ? <span className={styles.period}>{props.period}</span> : null}
        <div className={styles.metaRow}>
          <span className={styles.date}>{props.dateLabel}</span>
          <span className={styles.weekday}>{props.weekday}</span>
          {props.showWeek ? <span className={styles.week}>第 {props.weekOfYear} 周</span> : null}
        </div>
      </div>

      {props.showNextAlarm ? (
        <div className={styles.alarmBlock}>
          {props.nextReminders.length > 0 ? (
            props.nextReminders.map(function (item) {
              return (
                <div
                  key={item.reminder.id}
                  className={styles.alarmRow}>
                  <span className={styles.alarmLabel}>下个</span>
                  <span className={styles.alarmTime}>{item.reminder.fireTime}</span>
                  <span className={styles.alarmTitle}>{item.reminder.title || '闹钟'}</span>
                </div>
              )
            })
          ) : (
            <div className={styles.alarmEmpty}>暂无闹钟</div>
          )}
          {props.showAlarmSummary ? (
            <div className={styles.alarmSummary}>
              今日已开 {props.todayEnabled}
              {props.enabledTotal !== props.todayEnabled ? ` · 全部 ${props.enabledTotal}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}

