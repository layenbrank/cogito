import { Button } from '@i-thinking/design/components/button'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportUnknown } from '@/utils/exception-report.ts'

import { ERROR } from './constants.ts'
import styles from './error-boundary.module.scss'

type ErrorBoundaryProps = {
  children: ReactNode
  title?: string
  subTitle?: string
  /** Compact inline fallback for nested/feature isolation */
  compact?: boolean
  onError?: (error: Error, info: ErrorInfo) => void
  onReset?: () => void
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    reportUnknown(
      error,
      { kind: 'ErrorBoundary', componentStack: info.componentStack ?? undefined },
      'fatal'
    )
    this.props.onError?.(error, info)
  }

  private onRetry = () => {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  private onReload = () => {
    window.location.reload()
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.title ?? ERROR.TITLE
    const subTitle = this.props.subTitle ?? ERROR.SUBTITLE
    const message = this.state.error?.message

    if (this.props.compact) {
      return (
        <div
          className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-2 bg-transparent p-4"
          role="alert">
          <p className="text-sm text-muted-foreground">{title}</p>
          {import.meta.env.DEV && message ? (
            <p className="max-w-md truncate text-xs text-destructive">{message}</p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={this.onRetry}>
            {ERROR.RETRY}
          </Button>
        </div>
      )
    }

    return (
      <div
        className={styles.root}
        role="alert"
        aria-live="assertive">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-lg font-medium">{title}</h1>
          <p className="text-sm text-muted-foreground">{subTitle}</p>
          {import.meta.env.DEV && message ? (
            <p className="max-w-full break-all rounded-md bg-muted px-3 py-2 text-left text-xs text-destructive">
              {message}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={this.onRetry}>{ERROR.RETRY}</Button>
            <Button
              variant="outline"
              onClick={this.onReload}>
              {ERROR.RELOAD}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}

export type { ErrorBoundaryProps }
export { ErrorBoundary }
