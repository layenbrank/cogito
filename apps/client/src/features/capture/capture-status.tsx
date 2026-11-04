import { Button } from '@cogito/design/components/button'
import { convertFileSrc } from '@tauri-apps/api/core'
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

/**
 * 加载态底图：**冻结帧本身**而不是黑幕。
 *
 * 黑幕是不透明的 #0a0a0a，4K PNG 解码 + Konva 首帧要 200~800ms，这段时间整屏纯黑，
 * 用户会以为截屏挂了。这里一拿到 path 就把冻结帧铺成背景（与 Konva 底图同源同图，
 * 视觉一致），只剩右下角一行进度；`img.decode()` 完成后整块换成 Konva 画布。
 *
 * 注意：这**不是**用 DOM 替代 Konva 底图（见 docs/capture-sharpness-and-selection.md §3.3）——
 * 它只在 loading 阶段存在，且 `pointer-events: auto` 本就吃掉事件，ready 后立刻卸载。
 */
function CaptureLoadingMask(props: { sourcePath?: string | null }) {
  const backdrop = props.sourcePath ? convertFileSrc(props.sourcePath) : null
  return (
    <div
      className={styles.loadingMask}
      aria-busy="true"
      aria-label="正在加载截图"
      style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}>
      <span className={styles.loadingBadge}>正在准备冻结帧…</span>
    </div>
  )
}

export { CaptureErrorSurface, CaptureLoadingMask }
