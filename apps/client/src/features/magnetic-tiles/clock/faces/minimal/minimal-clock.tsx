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
      {/*
        秒槽的 AnimatePresence 必须在条件之外：若它与退场子元素一起卸载，关闭秒显示时秒的退场动画会丢
        内层再包一层，是为了让「秒数变化」仍能触发翻牌退场
      */}
      <AnimatePresence
        mode="sync"
        initial={false}>
        {props.showSeconds ? (
          <m.span
            key="seconds"
            className={styles.minimalSecSlot}
            initial={isReduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={isReduced ? undefined : { opacity: 0 }}>
            <AnimatePresence
              mode="sync"
              initial={false}>
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
            </AnimatePresence>
          </m.span>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
