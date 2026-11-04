import { Component, type ErrorInfo, type ReactNode } from 'react'

import styles from '@/features/capture/capture.module.scss'
import { reportUnknown } from '@/utils/exception-report.ts'

interface CaptureErrorBoundaryProps {
  children: ReactNode
  onError: () => void
  onClose: () => void
}

interface CaptureErrorBoundaryState {
  error: Error | null
}

class CaptureErrorBoundary extends Component<CaptureErrorBoundaryProps, CaptureErrorBoundaryState> {
  override state: CaptureErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[CaptureErrorBoundary]', error, info)
    reportUnknown(
      error,
      { kind: 'CaptureErrorBoundary', componentStack: info.componentStack ?? undefined },
      'error'
    )
    // onError → toScreenshotExit；它自己也可能是错的（store / IPC 一起坏了），
    // 所以必须再兜一层：退到 onClose，至少把窗口收掉，别让透明浮层继续吃点击。
    try {
      this.props.onError()
    } catch (nested) {
      console.error('[CaptureErrorBoundary] onError 自身失败，退回 onClose', nested)
      try {
        this.props.onClose()
      } catch (closeError) {
        console.error('[CaptureErrorBoundary] onClose 也失败，只能靠 Rust 看门狗', closeError)
      }
    }
  }

  override render() {
    if (this.state.error) {
      if (import.meta.env.DEV) {
        return (
          <div className={styles.errorPanel}>
            <div className={styles.errorCard}>
              <span className={styles.errorBadge}>CAPTURE CRASH</span>
              <p className={styles.errorMessage}>{this.state.error.message}</p>
            </div>
          </div>
        )
      }
      return null
    }
    return this.props.children
  }
}

export type { CaptureErrorBoundaryProps }
export { CaptureErrorBoundary }
