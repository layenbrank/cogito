/**
 * 对话区动效约定：平滑 ease-out，禁止 spring / 过冲回弹。
 */
import { motion, useReducedMotion, type Transition } from 'motion/react'
import type { ReactNode } from 'react'

/** 与 CSS `cubic-bezier(0.22, 1, 0.36, 1)` 一致：快起缓停、无过冲 */
const CHAT_EASE = [0.22, 1, 0.36, 1] as const

const CHAT_DURATION_MS = 220

const CHAT_ENTER: Transition = {
  duration: CHAT_DURATION_MS / 1000,
  ease: CHAT_EASE
}

const CHAT_FADE: Transition = {
  duration: 0.18,
  ease: CHAT_EASE
}

/** Tailwind 用：折叠 / chevron 过渡 */
const CHAT_EASE_CLASS = 'ease-[cubic-bezier(0.22,1,0.36,1)]'

interface ChatEnterProps {
  children: ReactNode
  className?: string
  /** 入场位移（px），默认 4，偏小更稳 */
  offset?: number
  /** 透传 data-* 等 */
  'data-slot'?: string
}

function ChatEnter(props: ChatEnterProps) {
  const { children, className, offset = 4, ...rest } = props
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: offset }}
      animate={{ opacity: 1, y: 0 }}
      transition={CHAT_ENTER}
      {...rest}>
      {children}
    </motion.div>
  )
}

export {
  CHAT_DURATION_MS,
  CHAT_EASE,
  CHAT_EASE_CLASS,
  CHAT_ENTER,
  CHAT_FADE,
  ChatEnter
}
