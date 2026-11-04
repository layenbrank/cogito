import { Button } from '@cogito/design/components/button'
import { useEffect } from 'react'
import { useLocation, useRouteError } from 'react-router-dom'

import { reportUnknown } from '@/utils/exception-report.ts'

const HOME_PATH = '/overview'

/**
 * 路由级兜底（`errorElement`）。
 *
 * 覆盖「渲染时抛错 / loader 抛错 / 懒加载 chunk 拉不下来」三种情况。
 * 有它之后，单个视图崩掉只坏这一页，导航与磁贴墙仍然可用。
 */
function RouteErrorElement() {
  const error = useRouteError()
  const location = useLocation()

  useEffect(
    function () {
      reportUnknown(
        error,
        { kind: 'route.errorElement', path: location.pathname },
        'fatal'
      )
    },
    [error, location.pathname]
  )

  const message = error instanceof Error ? error.message : String(error ?? '')

  return (
    <div
      className="flex h-full min-h-48 w-full flex-col items-center justify-center gap-3 p-6 text-center"
      role="alert">
      <p className="text-sm font-medium">这个页面加载失败了</p>
      <p className="max-w-md text-xs text-muted-foreground">
        其它功能不受影响，可以回到首页或刷新重试。
      </p>
      {import.meta.env.DEV && message ? (
        <p className="max-w-full break-all rounded-md bg-muted px-3 py-2 text-left text-xs text-destructive">
          {message}
        </p>
      ) : null}
      <div className="mt-1 flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={function () {
            window.location.assign(HOME_PATH)
          }}>
          回到首页
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={function () {
            window.location.reload()
          }}>
          刷新
        </Button>
      </div>
    </div>
  )
}

export { RouteErrorElement }
