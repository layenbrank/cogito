import clsx from 'clsx'
import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'

import { DIGIT } from '@/features/magnetic-tiles/clock/clock-motion.ts'
import styles from './minimal.module.scss'

interface MinimalClockProps {
  h: string
  m: string
  s: string
  showSeconds: boolean
  className?: string
  isNeon?: boolean
}

export function MinimalClock(props: MinimalClockProps) {
  const isReduced = !!useReducedMotion()
  const transition = DIGIT.transition(isReduced)
  const timeKey = `${props.h}${props.m}`

  return (
    <div className={clsx(styles.minimal, props.isNeon && styles.tonePrimary, props.className)}>
      <span className={styles.minimalTimeSlot}>
        <AnimatePresence
          mode="sync"
          initial={false}>
          <m.span
            key={timeKey}
            className={styles.minimalTime}
            variants={DIGIT.variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={transition}
            style={{ transformStyle: 'preserve-3d' }}>
            {props.h}:{props.m}
          </m.span>
        </AnimatePresence>
      </span>
      <span className={styles.minimalSecSlot}>
        <AnimatePresence
          mode="sync"
          initial={false}>
          {props.showSeconds ? (
            <m.span
              key={props.s}
              className={styles.minimalSec}
              variants={DIGIT.variants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
              style={{ transformStyle: 'preserve-3d' }}>
              {props.s}
            </m.span>
          ) : null}
        </AnimatePresence>
      </span>
    </div>
  )
}

