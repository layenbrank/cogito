import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'

import styles from '@/features/capture/capture.module.scss'

interface OcrSurfaceProps {
  text: string
  busy: boolean
  /** 有选区时才能插进标注 */
  canInsert: boolean
  onCopy: () => void
  onInsert: () => void
  onClose: () => void
}

/** 取字结果面板：只读文本 + 复制 / 插入标注 */
function OcrSurface(props: OcrSurfaceProps) {
  return (
    <div
      className={styles.ocrPanel}
      onMouseDown={function (event) {
        event.stopPropagation()
      }}>
      <div className={styles.ocrHead}>
        <span className={styles.ocrTitle}>{props.busy ? '正在取字…' : '识别结果'}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={styles.ocrClose}
          aria-label="关闭识别结果"
          onClick={props.onClose}>
          ×
        </Button>
      </div>
      <p className={styles.ocrText}>{props.text}</p>
      <div className={styles.ocrActions}>
        <Button
          type="button"
          variant="default"
          size="sm"
          className={clsx(styles.ocrButton, styles.ocrPrimary)}
          disabled={props.busy || props.text.length === 0}
          onClick={props.onCopy}>
          复制
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={styles.ocrButton}
          disabled={props.busy || !props.canInsert || props.text.length === 0}
          onClick={props.onInsert}>
          插入标注
        </Button>
      </div>
    </div>
  )
}

export type { OcrSurfaceProps }
export { OcrSurface }
