import { AnimatePresence, useReducedMotion } from 'motion/react'
import * as m from 'motion/react-m'
import type { ReactNode } from 'react'

import { MOTION } from './constants.ts'
import styles from './signin.module.scss'

type FormStaggerProps = {
  children: ReactNode
  className?: string
}

/** 面板进入时的字段级 stagger；key 只绑 panelMotionKey，勿绑 mode */
function FormStagger(props: FormStaggerProps) {
  const { children, className } = props
  const isReducedMotion = useReducedMotion()
  const containerVariants = MOTION.containerVariants(!!isReducedMotion)
  const transition = MOTION.transition(!!isReducedMotion)

  return (
    <m.div
      className={className}
      variants={containerVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={transition}>
      {children}
    </m.div>
  )
}

type MotionFieldProps = {
  children: ReactNode
  className?: string
}

function MotionField(props: MotionFieldProps) {
  const { children, className } = props
  const isReducedMotion = useReducedMotion()
  const itemVariants = MOTION.itemVariants({ isReducedMotion: !!isReducedMotion })
  const transition = MOTION.transition(!!isReducedMotion)

  return (
    <m.div
      className={className ?? styles.fieldMotion}
      variants={itemVariants}
      transition={transition}>
      {children}
    </m.div>
  )
}

type ModeSwapProps = {
  /** 身份模式；变化时只重建内部字段，外壳 Tabs/操作区不卸 */
  mode: string
  children: ReactNode
}

/**
 * 用户名 / 手机 / 邮箱切换：横向进退场。
 * 销毁范围仅限 children（身份字段 + 必要时验证码），保留 Tabs 与底部操作。
 */
function ModeSwap(props: ModeSwapProps) {
  const { mode, children } = props
  const isReducedMotion = useReducedMotion()
  const variants = MOTION.variants({
    isReducedMotion: !!isReducedMotion,
    offset: MOTION.OFFSET.X,
    axis: 'x'
  })
  const transition = MOTION.transition(!!isReducedMotion)

  return (
    <div className={styles.modeSwap}>
      <AnimatePresence
        mode="wait"
        initial={false}>
        <m.div
          key={mode}
          className={styles.modeSwapPane}
          initial={variants.initial}
          animate={variants.animate}
          exit={variants.exit}
          transition={transition}>
          {children}
        </m.div>
      </AnimatePresence>
    </div>
  )
}

export { FormStagger, ModeSwap, MotionField }
