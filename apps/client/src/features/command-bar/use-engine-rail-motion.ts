import { useReducedMotion } from 'motion/react'

import { COLLAPSED_PX, useEngineRailWidth } from '@/features/command-bar/use-engine-rail-width.ts'

/** Material 减速曲线，控制点 y ≤ 1，无回弹 */
const RAIL_EASE: [number, number, number, number] = [0.2, 0, 0, 1]

function useEngineRailMotion(isShellOpen: boolean, isExpanded: boolean) {
  const isReduced = useReducedMotion()
  const { chipsRef, expandedWidth, railMs } = useEngineRailWidth(isShellOpen)
  const duration = isReduced ? 0 : railMs / 1000

  const radius = isShellOpen
    ? isExpanded
      ? 'rounded-tl-[10px] rounded-tr-lg rounded-br-lg rounded-bl-md'
      : 'rounded-tl-[10px] rounded-tr-md rounded-b-md'
    : 'rounded-full'

  const widthTransition = { type: 'tween' as const, duration, ease: RAIL_EASE }
  const iconFade = {
    type: 'tween' as const,
    duration: duration * 0.35,
    ease: RAIL_EASE
  }
  const chipsFade = isExpanded
    ? {
        type: 'tween' as const,
        duration: duration * 0.5,
        ease: RAIL_EASE,
        delay: isReduced ? 0 : duration * 0.12
      }
    : {
        type: 'tween' as const,
        duration: duration * 0.3,
        ease: RAIL_EASE
      }

  const collapsedScale = Math.min(1, COLLAPSED_PX / expandedWidth)

  return {
    chipsRef,
    expandedWidth,
    railMs,
    radius,
    widthTransition,
    iconFade,
    chipsFade,
    collapsedScale
  }
}

export { useEngineRailMotion }
