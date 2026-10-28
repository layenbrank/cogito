import { clsx } from 'clsx'

import styles from '@/views/signboard/signboard.module.scss'

interface ProgressTextProps {
  done: number
  total: number
  className?: string
}

function ProgressText(props: ProgressTextProps) {
  const total = Math.max(0, props.total)
  const done = Math.max(0, Math.min(props.done, total))
  return (
    <span className={clsx(styles.progressText, props.className)}>
      {done}/{total}
    </span>
  )
}

interface ProgressBarProps {
  pct: number
  className?: string
  /** 紧凑：用于卡片 meta / 列头 */
  size?: 'sm' | 'md'
  tone?: 'default' | 'success' | 'danger'
  label?: string
}

function ProgressBar(props: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, props.pct))
  const size = props.size ?? 'sm'
  const tone = props.tone ?? (pct >= 100 ? 'success' : 'default')

  return (
    <div
      className={clsx(
        styles.progressBar,
        size === 'md' && styles.progressBarMd,
        props.className
      )}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={props.label ?? `进度 ${pct}%`}>
      <div
        className={clsx(
          styles.progressBarFill,
          tone === 'success' && styles.progressBarFillSuccess,
          tone === 'danger' && styles.progressBarFillDanger
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

interface ProgressCellProps {
  done: number
  total: number
  pct: number
}

/** 表格清单列：文字 + 迷你条；无清单显示 0/0 */
function ProgressCell(props: ProgressCellProps) {
  const total = Math.max(0, props.total)
  const done = total <= 0 ? 0 : props.done
  return (
    <div className={styles.progressCell}>
      <ProgressText
        done={done}
        total={total}
      />
      <ProgressBar
        pct={props.pct}
        size="sm"
        label={total > 0 ? `清单 ${done}/${total}` : '进度 0/0'}
      />
    </div>
  )
}

export { ProgressCell }
