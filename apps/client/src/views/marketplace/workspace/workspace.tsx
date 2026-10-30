import { Suspense, lazy, useContext } from 'react'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'

import {
  MarketplaceContext,
  type MarketplaceMode
} from '@/views/marketplace/workspace/context.tsx'
import { MOTION } from '@/views/marketplace/workspace/lib/motion.ts'
import { PageSkeleton } from '@/views/marketplace/workspace/skeleton.tsx'

const Booth = lazy(function () {
  return import('@/views/marketplace/workspace/booth/booth.tsx')
})
const Navigate = lazy(function () {
  return import('@/views/marketplace/workspace/navigate/navigate.tsx')
})
const Customize = lazy(function () {
  return import('@/views/marketplace/workspace/customize/customize.tsx')
})

const MODE_VIEWS: Record<MarketplaceMode, typeof Booth> = {
  booth: Booth,
  navigate: Navigate,
  customize: Customize
}

export default function Workspace() {
  const { mode } = useContext(MarketplaceContext)
  const isReducedMotion = !!useReducedMotion()
  const View = MODE_VIEWS[mode]
  const variants = MOTION.variants({ isReducedMotion })
  const transition = MOTION.transition(isReducedMotion)

  return (
    <Suspense fallback={<PageSkeleton />}>
      <AnimatePresence mode="wait">
        <m.div
          key={mode}
          className="flex h-full min-h-0 w-full flex-1 flex-col"
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={transition}>
          <View />
        </m.div>
      </AnimatePresence>
    </Suspense>
  )
}
