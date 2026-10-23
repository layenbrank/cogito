import { Button } from '@cogito/design/components/button'
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'

import { reportUnknown } from '@/utils/exception-report.ts'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  message: string
}

function parseErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.statusText || `请求失败（${error.status}）`
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '未知错误'
}

function RouteError() {
  const error = useRouteError()
  const message = parseErrorMessage(error)

  useEffect(
    function () {
      if (!error) return
      reportUnknown(error, { kind: 'react-router.RouteError' }, 'error')
    },
    [error]
  )

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
      <p>页面出错了，侧栏仍可切换到其他页面。</p>
      <p className="max-w-md text-center text-xs break-all">{message}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={function () {
          window.location.reload()
        }}>
        刷新重试
      </Button>
    </div>
  )
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Backend route error', error, info)
    reportUnknown(
      error,
      { kind: 'ErrorBoundary', componentStack: info.componentStack ?? undefined },
      'fatal'
    )
  }

  handleRetry() {
    this.setState({ hasError: false, message: '' })
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
          <p>页面出错了</p>
          <p className="max-w-md text-center text-xs break-all">{this.state.message}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={this.handleRetry.bind(this)}>
            重试
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      加载中…
    </div>
  )
}

export const Fallback = {
  ErrorBoundary,
  Route: RouteFallback,
  RouteError
}
