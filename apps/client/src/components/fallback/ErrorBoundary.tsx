import { Button } from '@cogito/design/components/button'
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { reportUnknown } from '@/utils/exception-report.ts'

import { ERROR } from './constants.ts'
import styles from './error-boundary.module.scss'

/** 默认允许手动重试几次；超过后只留「刷新 / 回到首页」，避免确定性错误无限闪。 */
const DEFAULT_MAX_RETRIES = 3
/** 回到磁贴墙（`/overview` 是磁贴墙的 URL）。 */
const HOME_PATH = '/overview'

type ErrorBoundaryProps = {
  children: ReactNode
  title?: string
  subTitle?: string
  /** Compact inline fallback for nested/feature isolation */
  compact?: boolean
  /** 上报里用来区分是哪一层边界接住的（`root` / `route:clock` / `tile:knowledge` …） */
  boundaryId?: string
  /**
   * 值变化即自动重试。用于「路由/label 变了说明已经不是同一个场景」的恢复，
   * 避免用户切走再切回来还卡在兜底页。
   */
  resetKeys?: readonly unknown[]
  /** 手动重试次数上限，默认 3 */
  maxRetries?: number
  onError?: (error: Error, info: ErrorInfo) => void
  onReset?: () => void
}

type ErrorBoundaryState = {
  hasError: boolean
  error: Error | null
  /** 已手动重试次数 */
  retries: number
  /** resetKeys 的签名，用来判断「外部输入变了」 */
  signature: string
}

/** resetKeys 的比较签名：用 JSON 而不是引用比较，父组件每次渲染新建数组也不会误触发。 */
function signatureOf(keys: readonly unknown[] | undefined): string {
  if (!keys || keys.length === 0) return ''
  try {
    return JSON.stringify(keys)
  } catch (error) {
    console.warn('[ErrorBoundary] resetKeys 无法序列化，退化为字符串比较', error)
    return keys.map((key) => String(key)).join('|')
  }
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      retries: 0,
      signature: signatureOf(props.resetKeys)
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  /**
   * `resetKeys` 变化时自动解除兜底态。
   * 只在「正处在兜底态」时才检查，平时不干扰正常渲染。
   */
  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState
  ): Partial<ErrorBoundaryState> | null {
    const signature = signatureOf(props.resetKeys)
    if (signature === state.signature) return null
    if (!state.hasError) return { signature }
    return { hasError: false, error: null, signature }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.boundaryId ?? 'unknown', error, info.componentStack)
    reportUnknown(
      error,
      {
        kind: 'ErrorBoundary',
        boundaryId: this.props.boundaryId ?? 'unknown',
        compact: this.props.compact ?? false,
        retries: this.state.retries,
        componentStack: info.componentStack ?? undefined
      },
      'fatal'
    )
    this.props.onError?.(error, info)
  }

  private onRetry = () => {
    this.setState((previous) => ({
      hasError: false,
      error: null,
      retries: previous.retries + 1,
      signature: signatureOf(this.props.resetKeys)
    }))
    this.props.onReset?.()
  }

  private onReload = () => {
    window.location.reload()
  }

  private onGoHome = () => {
    window.location.assign(HOME_PATH)
  }

  private get exhausted(): boolean {
    return this.state.retries >= (this.props.maxRetries ?? DEFAULT_MAX_RETRIES)
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    const title = this.props.title ?? ERROR.TITLE
    const subTitle = this.props.subTitle ?? ERROR.SUBTITLE
    const message = this.state.error?.message
    const exhausted = this.exhausted

    if (this.props.compact) {
      return (
        <div
          className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-2 bg-transparent p-4"
          role="alert">
          <p className="text-sm text-muted-foreground">{title}</p>
          {import.meta.env.DEV && message ? (
            <p className="max-w-md truncate text-xs text-destructive">{message}</p>
          ) : null}
          {exhausted ? (
            <Button
              size="sm"
              variant="outline"
              onClick={this.onReload}>
              {ERROR.RELOAD}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={this.onRetry}>
              {ERROR.RETRY}
            </Button>
          )}
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
          <p className="text-sm text-muted-foreground">
            {exhausted ? '多次重试仍未恢复，请刷新页面或回到首页。' : subTitle}
          </p>
          {import.meta.env.DEV && message ? (
            <p className="max-w-full break-all rounded-md bg-muted px-3 py-2 text-left text-xs text-destructive">
              {message}
            </p>
          ) : null}
          <div className="mt-2 flex items-center gap-3">
            {exhausted ? null : <Button onClick={this.onRetry}>{ERROR.RETRY}</Button>}
            <Button
              variant="outline"
              onClick={this.onGoHome}>
              回到首页
            </Button>
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
export { DEFAULT_MAX_RETRIES, ErrorBoundary }
