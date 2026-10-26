import { clsx } from 'clsx'

import styles from '@/features/capture/capture.module.scss'

interface OcrPanelProps {
  text: string
  busy: boolean
  /** 有选区时才能插进标注 */
  canInsert: boolean
  onCopy: () => void
  onInsert: () => void
  onClose: () => void
}

/** 取字结果面板：只读文本 + 复制 / 插入标注 */
function OcrPanel(props: OcrPanelProps) {
  return (
    <div
      className={styles.ocrPanel}
      onMouseDown={function (event) {
        event.stopPropagation()
      }}>
      <div className={styles.ocrHead}>
        <span className={styles.ocrTitle}>{props.busy ? '正在取字…' : '识别结果'}</span>
        <button
          type="button"
          className={styles.ocrClose}
          aria-label="关闭识别结果"
          onClick={props.onClose}>
          ×
        </button>
      </div>
      <p className={styles.ocrText}>{props.text}</p>
      <div className={styles.ocrActions}>
        <button
          type="button"
          className={clsx(styles.ocrButton, styles.ocrPrimary)}
          disabled={props.busy || props.text.length === 0}
          onClick={props.onCopy}>
          复制
        </button>
        <button
          type="button"
          className={styles.ocrButton}
          disabled={props.busy || !props.canInsert || props.text.length === 0}
          onClick={props.onInsert}>
          插入标注
        </button>
      </div>
    </div>
  )
}

export type { OcrPanelProps }
export { OcrPanel }
