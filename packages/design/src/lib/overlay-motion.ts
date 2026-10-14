import { cn } from 'cn'

/**
 * 浮层进出场：对齐 Base UI `data-starting-style` / `data-ending-style`。
 * 居中弹层用 scale；贴边抽屉用 translate，避免互相覆盖。
 *
 * 入场首帧必须配合 globals.css 里对 `[data-starting-style] { transition: none }`
 * 的补丁（Dialog.Popup 未像 Menu 那样注入 getDisabledMountTransitionStyles）。
 */

type OverlaySide = 'center' | 'top' | 'right' | 'bottom' | 'left'

const MOTION_EASE = 'ease-[cubic-bezier(0.22,1,0.36,1)]'
const MOTION_DURATION = 'duration-200'

/** 遮罩淡入淡出（Dialog / AlertDialog / Sheet 共用） */
const OVERLAY_BACKDROP_MOTION = cn(
  'transition-opacity',
  MOTION_DURATION,
  'ease-out',
  'data-starting-style:opacity-0 data-ending-style:opacity-0',
  'motion-reduce:transition-none'
)

/** 居中：opacity + scale（登录等居中弹层） */
const OVERLAY_CENTER_MOTION = cn(
  'origin-center scale-100 opacity-100',
  'transition-[opacity,scale]',
  MOTION_DURATION,
  MOTION_EASE,
  'data-starting-style:scale-[0.96] data-starting-style:opacity-0',
  'data-ending-style:scale-[0.96] data-ending-style:opacity-0',
  'motion-reduce:transition-none',
  'motion-reduce:data-starting-style:scale-100 motion-reduce:data-ending-style:scale-100'
)

/** 右侧抽屉：从屏外滑入 */
const OVERLAY_RIGHT_MOTION = cn(
  'translate-x-0 opacity-100',
  'transition-[opacity,translate]',
  MOTION_DURATION,
  MOTION_EASE,
  'data-starting-style:translate-x-full data-starting-style:opacity-0',
  'data-ending-style:translate-x-full data-ending-style:opacity-0',
  'motion-reduce:transition-none',
  'motion-reduce:data-starting-style:translate-x-0 motion-reduce:data-ending-style:translate-x-0'
)

const OVERLAY_LEFT_MOTION = cn(
  'translate-x-0 opacity-100',
  'transition-[opacity,translate]',
  MOTION_DURATION,
  MOTION_EASE,
  'data-starting-style:-translate-x-full data-starting-style:opacity-0',
  'data-ending-style:-translate-x-full data-ending-style:opacity-0',
  'motion-reduce:transition-none',
  'motion-reduce:data-starting-style:translate-x-0 motion-reduce:data-ending-style:translate-x-0'
)

const OVERLAY_TOP_MOTION = cn(
  'translate-y-0 opacity-100',
  'transition-[opacity,translate]',
  MOTION_DURATION,
  MOTION_EASE,
  'data-starting-style:-translate-y-full data-starting-style:opacity-0',
  'data-ending-style:-translate-y-full data-ending-style:opacity-0',
  'motion-reduce:transition-none',
  'motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-ending-style:translate-y-0'
)

const OVERLAY_BOTTOM_MOTION = cn(
  'translate-y-0 opacity-100',
  'transition-[opacity,translate]',
  MOTION_DURATION,
  MOTION_EASE,
  'data-starting-style:translate-y-full data-starting-style:opacity-0',
  'data-ending-style:translate-y-full data-ending-style:opacity-0',
  'motion-reduce:transition-none',
  'motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-ending-style:translate-y-0'
)

/** 贴边抽屉的布局壳（不含动效） */
const OVERLAY_SIDE_LAYOUT: Record<Exclude<OverlaySide, 'center'>, string> = {
  right: 'inset-y-0 top-0 right-0 bottom-0 left-auto h-full max-h-none w-full max-w-sm rounded-none rounded-l-xl',
  left: 'inset-y-0 top-0 bottom-0 left-0 right-auto h-full max-h-none w-full max-w-sm rounded-none rounded-r-xl',
  top: 'inset-x-0 top-0 right-0 left-0 bottom-auto h-auto max-h-[85vh] w-full max-w-none rounded-none rounded-b-xl',
  bottom:
    'inset-x-0 bottom-0 right-0 left-0 top-auto h-auto max-h-[85vh] w-full max-w-none rounded-none rounded-t-xl'
}

const OVERLAY_SIDE_MOTION: Record<OverlaySide, string> = {
  center: OVERLAY_CENTER_MOTION,
  right: OVERLAY_RIGHT_MOTION,
  left: OVERLAY_LEFT_MOTION,
  top: OVERLAY_TOP_MOTION,
  bottom: OVERLAY_BOTTOM_MOTION
}

/** 居中弹层默认定位 */
const OVERLAY_CENTER_LAYOUT =
  'top-1/2 left-1/2 w-full max-h-[min(85vh,40rem)] max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 sm:max-w-sm'

function findOverlaySideClass(side: OverlaySide = 'center') {
  if (side === 'center') {
    return cn(OVERLAY_CENTER_LAYOUT, OVERLAY_CENTER_MOTION)
  }
  return cn(OVERLAY_SIDE_LAYOUT[side], OVERLAY_SIDE_MOTION[side])
}

export {
  findOverlaySideClass,
  OVERLAY_BACKDROP_MOTION,
  OVERLAY_BOTTOM_MOTION,
  OVERLAY_CENTER_LAYOUT,
  OVERLAY_CENTER_MOTION,
  OVERLAY_LEFT_MOTION,
  OVERLAY_RIGHT_MOTION,
  OVERLAY_SIDE_LAYOUT,
  OVERLAY_SIDE_MOTION,
  OVERLAY_TOP_MOTION
}
export type { OverlaySide }
