import { Activity, Suspense, lazy } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { isOverviewPath } from '@/features/magnetic-tile/overview-path'

const Overview = lazy(function () {
  return import('@/views/overview/overview.tsx')
})

/**
 * 主窗工作台壳：磁贴墙用 Activity 常驻，切应用时 hidden 保 state/DOM；
 * 应用页仍走 outlet（外层 RouteTransition）。
 */
function WorkspaceShell() {
  const location = useLocation()
  const isOverview = isOverviewPath(location.pathname)

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col">
      <Activity mode={isOverview ? 'visible' : 'hidden'}>
        <div className="absolute inset-0 flex flex-col">
          <Suspense fallback={<Fallback.Route />}>
            <Overview />
          </Suspense>
        </div>
      </Activity>
      <div
        className={
          isOverview
            ? 'pointer-events-none absolute inset-0 hidden'
            : 'relative z-10 flex h-full min-h-0 w-full flex-col'
        }
        aria-hidden={isOverview || undefined}>
        <Outlet />
      </div>
    </div>
  )
}

export { WorkspaceShell }
