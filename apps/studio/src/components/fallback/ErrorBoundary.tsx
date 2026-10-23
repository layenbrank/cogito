import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ERROR } from './constants.ts'
import styles from './error-boundary.module.scss'

interface ErrorBoundaryProps {
  children: ReactNode
  title?: string
  subTitle?: string
  onError?: (error: Error, info: ErrorInfo) => void
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
    this.handleRetry = this.handleRetry.bind(this)
    this.handleReload = this.handleReload.bind(this)
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.props.onError?.(error, info)
  }

  handleRetry() {
    this.setState({ hasError: false, error: null })
    this.props.onReset?.()
  }

  handleReload() {
    window.location.reload()
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.title ?? ERROR.TITLE
    const subTitle = this.props.subTitle ?? ERROR.SUBTITLE

    return (
      <div
        className={styles.root}
        role="alert"
        aria-live="assertive">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <Icon icon="lucide:triangle-alert"
            aria-hidden
            className="size-12 text-destructive" />
          <h1 className="text-lg font-medium">{title}</h1>
          <p className="text-sm text-muted-foreground">{subTitle}</p>
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={this.handleRetry}>{ERROR.RETRY}</Button>
            <Button
              variant="outline"
              onClick={this.handleReload}>
              {ERROR.RELOAD}
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
