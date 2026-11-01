import { EASE_OUT } from '@cogito/design/lib/motion'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { Suspense, useState } from 'react'
import { NavigationType, useLocation, useMatches, useNavigationType, useOutlet } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'
import { isOverviewPath } from '@/features/magnetic-tile/overview-path'

import { findTransitionKey } from './transition-key.ts'

/** 进场横向滑入；方向跟导航（前进右进、返回左进） */
const ENTER_SLIDE_PX = 24
const ENTER_DURATION = 0.24

/**
 * 路由切换的进场动效（挂在无路径布局路由上，见 `index.tsx`）。
 *
 * 按页面（路由，见 `findTransitionKey`）换 key → 新页面挂载即播一次进场：
 * - 墙 → 应用、应用 ↔ 应用：slide + fade（~240ms / 24px）。纯淡入太像刷新，读不出「进了子页」。
 * - 应用 → 墙：不播。WorkspaceShell 会立刻收起 outlet（墙由 Activity 显回），此处再播只会跟显隐抢帧。
 *
 * **不做退场**：退场要 `AnimatePresence` 把旧节点留在树上等动画播完，而 motion 的动画靠 rAF 推进，
 * 窗口被遮挡 / 最小化时 rAF 会暂停，那时切路由会把新页面卡住不挂载（URL 已变、DOM 还停在旧页）。
 *
 * 懒加载页面在 chunk 到位前会 suspend：占位由这里的 `<Suspense>` 接住，
 * 这样首次进页面也能播进场。
 *
 * `initial={false}` 只关掉「窗口刚打开那一次」的动画：启动时页面应该直接就是亮的。
 * 缓动对齐 design `EASE_OUT`；`prefers-reduced-motion` 下只留极短淡入。
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

  const isEnteringApp = !isOverviewPath(location.pathname) && isOverviewPath(fromPath)
  const isAppSwitch = !isOverviewPath(fromPath) && !isOverviewPath(location.pathname)
  const shouldEnter = isEnteringApp || isAppSwitch

  const direction = navigationType === NavigationType.Pop ? -1 : 1

  let distance = 0
  let duration = 0
  let initialOpacity = 1

  if (shouldEnter) {
    if (isReducedMotion) {
      duration = 0.08
      initialOpacity = 0
    } else {
      duration = ENTER_DURATION
      initialOpacity = 0
      distance = ENTER_SLIDE_PX * direction
    }
  }

  return (
    <AnimatePresence initial={false}>
      <m.div
        key={findTransitionKey(matches)}
        className="flex h-full min-h-0 w-full flex-col"
        initial={{ opacity: initialOpacity, x: distance }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration, ease: EASE_OUT }}>
        <Suspense fallback={<Fallback.Route />}>{outlet}</Suspense>
      </m.div>
    </AnimatePresence>
  )
}

export { RouteTransition }
