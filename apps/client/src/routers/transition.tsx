import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Suspense } from 'react'
import { NavigationType, useMatches, useNavigationType, useOutlet } from 'react-router-dom'

import { Fallback } from '@/components/fallback/index.ts'

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
 */
function RouteTransition() {
  const matches = useMatches()
  const outlet = useOutlet()
  const navigationType = useNavigationType()
  const isReducedMotion = useReducedMotion()
  const direction = navigationType === NavigationType.Pop ? -1 : 1
  const distance = isReducedMotion ? 0 : 24 * direction

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={findTransitionKey(matches)}
        className="h-full w-full"
        initial={{ opacity: 0, x: distance }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}>
        <Suspense fallback={<Fallback.Route />}>{outlet}</Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

export { RouteTransition }
