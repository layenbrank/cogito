import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import styles from '@/features/capture/capture.module.scss'

interface CaptureErrorSurfaceProps {
  message: string | null
  onRetry: () => void
  onExit?: () => void
}

function CaptureErrorSurface(props: CaptureErrorSurfaceProps) {
  return (
    <div className={styles.errorPanel}>
      <div className={styles.errorCard}>
        <span className={styles.errorBadge}>CAPTURE FAILED</span>
        <p className={styles.errorMessage}>{props.message ?? '截图加载失败'}</p>
        <div className={styles.errorActions}>
          <Button
            type="button"
            variant="default"
            size="sm"
            className={clsx(styles.errorButton, styles.errorRetry)}
            onClick={props.onRetry}>
            重试
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={clsx(styles.errorButton, styles.errorExit)}
            onClick={function () {
              props.onExit?.()
            }}>
            退出
          </Button>
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

export { CaptureErrorSurface, CaptureLoadingMask }
