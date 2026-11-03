import { cn } from 'cn'

import { FOCUS_INVALID, FOCUS_RING } from './focus'

/**
 * 表单控件壳：Input / SelectTrigger 等共用。
 * 企业级默认：白底 + 轻阴影 + 与全局一致的 1px focus 环。
 */
const FIELD_SHELL = cn(
  'rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] outline-none',
  FOCUS_RING,
  FOCUS_INVALID
)

/**
 * 浮层抬升阴影：**无 border、无描边感**。
 * 只靠扩散阴影拉开层级，避免 `0 0 0 1px` 那种「假边框」。
 */
const OVERLAY_ELEVATION = cn(
  'border-0',
  'shadow-[0_2px_8px_-2px_rgba(15,23,42,0.10),0_12px_32px_-8px_rgba(15,23,42,0.14)]',
  'dark:shadow-[0_4px_12px_-2px_rgba(0,0,0,0.40),0_16px_40px_-10px_rgba(0,0,0,0.55)]'
)

/**
 * 浮层壳：Popover / DropdownMenu / Select / Combobox 等共用。
 *
 * 无边框，靠 OVERLAY_ELEVATION 软阴影拉开层级；动画 150ms。
 */
const OVERLAY_SHELL = cn(
  'rounded-xl bg-popover text-popover-foreground outline-hidden duration-150',
  OVERLAY_ELEVATION,
  'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
  'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
)

export { FIELD_SHELL, OVERLAY_ELEVATION, OVERLAY_SHELL }
