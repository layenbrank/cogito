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
 * 浮层壳：Select / DropdownMenu / Popover Popup 共用。
 * border + shadow-lg 在浅色同底上拉开层级；动画 150ms（企业级微交互区间）。
 */
const OVERLAY_SHELL = cn(
  'rounded-lg border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/5 outline-hidden duration-150',
  'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
  'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=inline-end]:slide-in-from-left-2 data-[side=inline-start]:slide-in-from-right-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2'
)

/**
 * 窗口操作层，和 `data-region` 并列。
 * `trigger` 是会打开浮层的控件，`overlay` 是浮层本身。
 * 主窗口里浮层盖住网页时，子 WebView 会沉到这层下面。
 */
const LAYER_TRIGGER = 'trigger'
const LAYER_OVERLAY = 'overlay'

export { FIELD_SHELL, OVERLAY_SHELL, LAYER_TRIGGER, LAYER_OVERLAY }
