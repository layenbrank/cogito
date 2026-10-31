import { useLayoutEffect, useRef, useState } from 'react'

import { OMNIBAR_UI } from '@/features/command-bar/constants'

/** 外壳水平 padding 合计（p-0.5 × 2） */
const PAD_X = 4
/** 收起：内槽 28 + PAD_X → 与 size-7 对齐 */
const COLLAPSED_PX = 28 + PAD_X

function useEngineRailWidth(isShellOpen: boolean) {
  const chipsRef = useRef<HTMLDivElement>(null)
  const [expandedWidth, setExpandedWidth] = useState(COLLAPSED_PX)

  useLayoutEffect(
    function measureExpanded() {
      const node = chipsRef.current
      if (!node) return
      const chips = node

      function measure() {
        const next = Math.ceil(chips.scrollWidth) + PAD_X
        if (next > 0) setExpandedWidth(next)
      }

      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(chips)
      return function () {
        observer.disconnect()
      }
    },
    [isShellOpen]
  )

  return { chipsRef, expandedWidth, collapsedPx: COLLAPSED_PX, padX: PAD_X, railMs: OMNIBAR_UI.RAIL_MS }
}

export { useEngineRailWidth, COLLAPSED_PX, PAD_X }
