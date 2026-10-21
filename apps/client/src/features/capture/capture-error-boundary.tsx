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
    this.props.onError()
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
