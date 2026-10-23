import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { Suspense, useState } from 'react'
import { NavigationType, useLocation, useMatches, useNavigationType, useOutlet } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { isOverviewPath } from '@/features/magnetic-tile/overview-path'

import { findTransitionKey } from './transition-key.ts'

/**
 * 路由切换的进场动效（挂在无路径布局路由上，见 `index.tsx`）。
 *
 * 按页面（路由，见 `findTransitionKey`）换 key → 新页面挂载即播一次「按导航方向滑入 + 淡入」：
 * 前进（PUSH，如 `/agent/chat` → `/agent/settings`）从右侧进，返回（POP）从左侧进。
 *
 * **不做退场**：退场要 `AnimatePresence` 把旧节点留在树上等动画播完，而 motion 的动画靠 rAF 推进，
 * 窗口被遮挡 / 最小化时 rAF 会暂停，那时切路由会把新页面卡住不挂载（URL 已变、DOM 还停在旧页）。
 *
 * 懒加载页面在 chunk 到位前会 suspend：占位由这里的 `<Suspense>` 接住（`Fallback.Route` 延迟才显），
 * 这样首次进页面也能播进场。
 *
 * `initial={false}` 只关掉「窗口刚打开那一次」的动画：启动时页面应该直接就是亮的。
 * 时长刻意短（~0.2s）；`prefers-reduced-motion` 下只留淡入，不做位移。
 * 磁贴墙 ↔ 应用：不做位移、不做淡入，避免与应用页首帧抢主线程。
 */
function RouteTransition() {
  const matches = useMatches()
  const outlet = useOutlet()
  const location = useLocation()
  const navigationType = useNavigationType()
  const isReducedMotion = useReducedMotion()
  const [trackedPath, setTrackedPath] = useState(location.pathname)
  const [fromPath, setFromPath] = useState(location.pathname)

  // 路径变化时在 render 中同步上一跳，供墙↔应用判断（替代 render 读 ref）
  if (trackedPath !== location.pathname) {
    setFromPath(trackedPath)
    setTrackedPath(location.pathname)
  }

  const isWallSwitch = isOverviewPath(fromPath) || isOverviewPath(location.pathname)

  const direction = navigationType === NavigationType.Pop ? -1 : 1
  const distance = isReducedMotion || isWallSwitch ? 0 : 24 * direction
  const duration = isWallSwitch ? 0 : 0.2

  return (
    <AnimatePresence initial={false}>
      <m.div
        key={findTransitionKey(matches)}
        className="flex h-full min-h-0 w-full flex-col"
        initial={{ opacity: isWallSwitch ? 1 : 0, x: distance }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration, ease: 'easeOut' }}>
        <Suspense fallback={<Fallback.Route />}>{outlet}</Suspense>
      </m.div>
    </AnimatePresence>
  )
}

export { RouteTransition }
