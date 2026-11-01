import { Activity, useMemo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { isOverviewPath } from '@/features/magnetic-tile/overview-path'
import { ShellFrame } from '@/features/window-shell/shell'
import { ShellSlotsProvider } from '@/features/window-shell/slots'
import { useOverviewTrail } from '@/views/overview/caption/trail'
import Overview from '@/views/overview/overview.tsx'

/**
 * 主窗工作台壳：稳定操作栏 + 磁贴墙 Activity 常驻；
 * 应用页走 outlet，经 useShellSurface 申报槽。
 *
 * 墙与应用同格叠放（relative + absolute inset-0）：Activity 保活墙面 DOM，
 * 切应用时 hidden 不卸树；两层始终铺满同一内容盒，不靠 flex 互斥猜高度。
 *
 * 墙面上的 outlet 层**不用 `display: none`**：父级从 none 切到可见的同一帧里，
 * RouteTransition 的进场（opacity / x）经常被浏览器直接合成到终态，看起来像「进子页没动效」。
 * 改为绝对铺满 + `pointer-events-none`，空 outlet 不挡墙点击，进场时父级本就可绘。
 */
function WorkspaceShell() {
  const location = useLocation()
  const isOverview = isOverviewPath(location.pathname)
  const trail = useOverviewTrail()

  const overviewCaption = useMemo(
    function () {
      return {
        center: trail.center,
        final: trail.final
      }
    },
    [trail.center, trail.final]
  )

  return (
    <ShellSlotsProvider>
      <ShellFrame overviewCaption={overviewCaption}>
        <div className="relative flex h-full min-h-0 w-full flex-col">
          <Activity mode={isOverview ? 'visible' : 'hidden'}>
            <div className="absolute inset-0 flex flex-col">
              <Overview signIn={trail.signIn} />
            </div>
          </Activity>
          <div
            className={
              isOverview
                ? 'pointer-events-none absolute inset-0'
                : 'relative z-10 flex h-full min-h-0 w-full flex-col'
            }
            aria-hidden={isOverview || undefined}>
            <Outlet />
          </div>
        </div>
      </ShellFrame>
    </ShellSlotsProvider>
  )
}

export { WorkspaceShell }
