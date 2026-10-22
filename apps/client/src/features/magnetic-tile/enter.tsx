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

/** 按镜面记是否已播过墙面入场；回墙 / Activity 再 visible 时不再重播 */
const enteredMirrors = new Set<string>()

function hasWallEntered(mirrorId: string | null | undefined) {
  if (!mirrorId) return false
  return enteredMirrors.has(mirrorId)
}

function markWallEntered(mirrorId: string | null | undefined) {
  if (!mirrorId) return
  enteredMirrors.add(mirrorId)
}

type EnterProps = {
  children: ReactNode
  /** 装配序号。入场不再按序号错开，视口内的磁贴同时播放 */
  index?: number
  /** 默认 true；冷启动后置 false 跳过入场 */
  isActive?: boolean
}

/**
 * 磁贴入场唯一入口：由 Controller 等装配层声明，Section surface 消费。
 * 包一层即启用；未包则默认无入场（浮层等复用方不受影响）。
 */
function Enter(props: EnterProps) {
  const isActive = props.isActive ?? true
  const value = useMemo(
    function () {
      return {
        isActive,
        index: props.index ?? 0
      } satisfies EnterValue
    },
    [props.index, isActive]
  )
  return <EnterContext value={value}>{props.children}</EnterContext>
}

function useEnter() {
  return useContext(EnterContext)
}

/** 对齐原 scroll-fx 入场参数。滚动阻尼仍由 gsap 负责，这里只做出现。 */
const DURATION = 0.75
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

export {
  Enter,
  EnterContext,
  ENTER,
  hasWallEntered,
  markWallEntered,
  useEnter
}
export type { EnterProps, EnterValue }
