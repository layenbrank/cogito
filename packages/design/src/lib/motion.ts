import type { Transition } from 'motion/react'

/**
 * design 包动效预设：业务侧优先复用，避免各页面各自调 duration / spring。
 * 节奏对齐指令墙（短、跟手）；`prefers-reduced-motion` 由调用方用 `useReducedMotion` 关掉位移。
 */

const EASE_OUT = [0.16, 1, 0.3, 1] as const

/** 按下反馈 —— Button / 步进器 / Toggle */
const TAP_SCALE = 0.97
const TAP_TRANSITION = {
  type: 'spring',
  stiffness: 520,
  damping: 32,
  mass: 0.4
} as const satisfies Transition

/** 浮层进场（Dialog / Popover / Select / Dropdown） */
const POP_TRANSITION = {
  duration: 0.18,
  ease: EASE_OUT
} as const satisfies Transition

const POP_INITIAL = { opacity: 0, scale: 0.98, y: 4 }
const POP_ANIMATE = { opacity: 1, scale: 1, y: 0 }
const POP_EXIT = { opacity: 0, scale: 0.98, y: 2 }

/** Checkbox / Radio 勾选点 */
const CHECK_TRANSITION = {
  type: 'spring',
  stiffness: 600,
  damping: 28
} as const satisfies Transition

/**
 * 数字切换（`AnimatedDigits`）—— 略长于点按反馈，ease-out 收尾更顺；
 * 只动 opacity + y，避免 layout 抖动。
 */
const DIGIT_EASE = [0.22, 1, 0.36, 1] as const
const DIGIT_TRANSITION = {
  duration: 0.3,
  ease: DIGIT_EASE
} as const satisfies Transition
/** 进/出场位移（px），与时长匹配，太短会显得「闪一下」 */
const DIGIT_OFFSET = 14

/**
 * React DOM 的 animation/drag 事件与 motion 同名 prop 冲突；
 * 铺到 `motion.*` / `motion.create(...)` 前先剥掉。
 */
function omitMotionConflicts<T extends object>(props: T) {
  const {
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    ...rest
  } = props as T & Record<string, unknown>
  return rest
}

export {
  CHECK_TRANSITION,
  DIGIT_EASE,
  DIGIT_OFFSET,
  DIGIT_TRANSITION,
  EASE_OUT,
  omitMotionConflicts,
  POP_ANIMATE,
  POP_EXIT,
  POP_INITIAL,
  POP_TRANSITION,
  TAP_SCALE,
  TAP_TRANSITION
}
