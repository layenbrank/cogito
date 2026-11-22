import type { Transition, Variants } from 'motion/react'

const FLIP_HALF_S = 0.28
const FLIP_TOTAL_MS = FLIP_HALF_S * 2 * 1000 + 48

/** 数字滚轮：短位移切入，无回弹；槽位 overflow 裁切 */
const DIGIT = {
  variants: {
    initial: { y: '-0.72em' },
    animate: { y: 0 },
    exit: { y: '0.72em' }
  } satisfies Variants,
  transition(isReduced: boolean): Transition {
    if (isReduced) return { duration: 0 }
    return {
      duration: 0.26,
      ease: 'easeOut'
    }
  }
}

const HAND = {
  second(isReduced: boolean): Transition {
    if (isReduced) return { duration: 0 }
    return { type: 'spring', visualDuration: 0.32, bounce: 0.12 }
  },
  minute(isReduced: boolean): Transition {
    if (isReduced) return { duration: 0 }
    return { type: 'spring', visualDuration: 0.4, bounce: 0.1 }
  },
  hour(isReduced: boolean): Transition {
    if (isReduced) return { duration: 0 }
    return { type: 'spring', visualDuration: 0.48, bounce: 0.08 }
  }
}

const COLON = {
  transition(isReduced: boolean): Transition {
    if (isReduced) return { duration: 0 }
    return { duration: 0.28, ease: 'easeInOut' }
  }
}

/** 顺时针累加角度，避免 359→0 时 Motion 数值回插倒转 */
function findClockwiseDeg(from: number, targetMod: number) {
  const mod = ((from % 360) + 360) % 360
  let delta = targetMod - mod
  if (delta < 0) delta += 360
  return from + delta
}

export {
  COLON,
  DIGIT,
  FLIP_HALF_S,
  FLIP_TOTAL_MS,
  HAND,
  findClockwiseDeg
}
