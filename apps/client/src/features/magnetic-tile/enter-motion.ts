import type { Transition, Variants } from 'motion/react'

/** 对齐原 scroll-fx 入场参数。滚动阻尼仍由 gsap 负责，这里只做出现。 */
const DURATION = 0.75
/** 毫秒；Controller 关入场波次用 */
const DURATION_MS = Math.round(DURATION * 1000)
const OFFSET_Y = -36
const SCALE = 0.5
const EASE = [0.34, 1.56, 0.64, 1] as const

const ENTER = {
  variants: {
    hidden: {
      opacity: 0,
      y: OFFSET_Y,
      scale: SCALE
    },
    show: {
      opacity: 1,
      y: 0,
      scale: 1
    }
  } satisfies Variants,
  transition(isReducedMotion: boolean): Transition {
    if (isReducedMotion) {
      return { duration: 0 }
    }
    return {
      duration: DURATION,
      ease: EASE
    }
  }
}

export { DURATION_MS, ENTER }
