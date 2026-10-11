import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Transition, Variants } from 'motion/react'

type EnterValue = {
  isActive: boolean
  index: number
}

const ENTER_IDLE: EnterValue = {
  isActive: false,
  index: 0
}

const EnterContext = createContext<EnterValue>(ENTER_IDLE)

type EnterProps = {
  children: ReactNode
  /** 序号，用于 stagger delay */
  index?: number
}

/**
 * 磁贴入场唯一入口：由 Controller 等装配层声明，Section surface 消费。
 * 包一层即启用；未包则默认无入场（浮层等复用方不受影响）。
 */
function Enter(props: EnterProps) {
  const value = useMemo(function () {
    return {
      isActive: true,
      index: props.index ?? 0
    } satisfies EnterValue
  }, [props.index])
  return <EnterContext value={value}>{props.children}</EnterContext>
}

function useEnter() {
  return useContext(EnterContext)
}

/** 对齐原 scroll-fx 入场参数 */
const DURATION = 0.75
const OFFSET_Y = -36
const SCALE = 0.5
const STAGGER = 0.04
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
  transition(index: number, isReducedMotion: boolean): Transition {
    if (isReducedMotion) {
      return { duration: 0 }
    }
    return {
      duration: DURATION,
      ease: EASE,
      delay: index * STAGGER
    }
  }
}

export { Enter, EnterContext, ENTER, useEnter }
export type { EnterProps, EnterValue }
