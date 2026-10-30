type Axis = 'x' | 'y'

interface SlideMotionOptions {
  isReducedMotion: boolean
  offset?: number
  axis?: Axis
}

const MOTION = {
  DURATION: 0.22,
  EASE: [0.22, 1, 0.36, 1] as const,
  OFFSET: {
    VIEW: 8,
    LIST: 10
  },
  STAGGER: 0.04,
  SUCCESS_MS: 600,
  transition(isReducedMotion: boolean) {
    return {
      duration: isReducedMotion ? 0 : MOTION.DURATION,
      ease: MOTION.EASE
    }
  },
  variants(options: SlideMotionOptions) {
    const { isReducedMotion, offset = MOTION.OFFSET.VIEW, axis = 'y' } = options
    const slide = axis === 'x' ? 'x' : 'y'
    return {
      initial: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : offset
      },
      animate: { opacity: 1, [slide]: 0 },
      exit: {
        opacity: isReducedMotion ? 1 : 0,
        [slide]: isReducedMotion ? 0 : axis === 'x' ? -offset * 0.5 : -offset
      }
    }
  },
  listContainer(isReducedMotion: boolean) {
    return {
      initial: 'hidden',
      animate: 'show',
      variants: {
        hidden: {},
        show: {
          transition: {
            staggerChildren: isReducedMotion ? 0 : MOTION.STAGGER
          }
        }
      }
    }
  },
  listItem(isReducedMotion: boolean) {
    return {
      variants: {
        hidden: {
          opacity: isReducedMotion ? 1 : 0,
          y: isReducedMotion ? 0 : MOTION.OFFSET.LIST
        },
        show: {
          opacity: 1,
          y: 0,
          transition: MOTION.transition(isReducedMotion)
        }
      }
    }
  }
}

export { MOTION }
export type { SlideMotionOptions }
