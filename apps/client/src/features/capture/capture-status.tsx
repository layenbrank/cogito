import { clsx } from 'clsx'

import styles from '@/features/capture/capture.module.scss'

interface CaptureErrorPanelProps {
  message: string | null
  onRetry: () => void
  onExit?: () => void
}

function CaptureErrorPanel(props: CaptureErrorPanelProps) {
  return (
    <div className={styles.errorPanel}>
      <div className={styles.errorCard}>
        <span className={styles.errorBadge}>CAPTURE FAILED</span>
        <p className={styles.errorMessage}>{props.message ?? '截图加载失败'}</p>
        <div className={styles.errorActions}>
          <button
            type="button"
            className={clsx(styles.errorButton, styles.errorRetry)}
            onClick={props.onRetry}>
            重试
          </button>
          <button
            type="button"
            className={clsx(styles.errorButton, styles.errorExit)}
            onClick={function () {
              props.onExit?.()
            }}>
            退出
          </button>
        </div>
      </div>
    </div>
  )
}

function CaptureLoadingMask() {
  return (
    <div
      className={styles.loadingMask}
      aria-busy="true"
      aria-label="正在加载截图"
    />
  )
}

export { CaptureErrorPanel, CaptureLoadingMask }
