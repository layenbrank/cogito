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

/**
 * 贴合式触发器（SelectTrigger / ComboboxTrigger / ComboboxInput）。
 *
 * 展开后触发器与列表面板拼成**一张卡**，两边必须是同一套视觉语言：
 * - **同一块面**：展开时底色切到 `popover`（面板色）。深色主题下 `bg-background`
 *   叠 `bg-input/30` 的合成色比面板暗一档，接缝处会出现色阶断层；浅色主题两者
 *   都是白，切过去无副作用。
 * - **同一条轮廓**：贴合的面板补 1px `input` 描边（见各自 Content 的 `ATTACHED` 注释），
 *   触发器接缝侧的 1px 由面板重叠的 `-1px` 吃掉，于是上下两半共用一条线。
 * - **悬停/聚焦只属于「未展开」的控件**：展开态若仍保留 `hover:border-ring` /
 *   `focus-visible:border-ring`，触发器描边会在接缝处变成 ring 色，和面板的 input
 *   色拼成深浅两段 —— 那正是「上下风格不统一」的来源。
 * - 接缝侧去圆角，`!` 盖过 size 变体里的 `rounded-*`。
 */
const ATTACHED_TRIGGER = cn(
  'data-popup-open:ring-0 data-popup-open:shadow-none',
  'data-popup-open:bg-popover dark:data-popup-open:bg-popover',
  // dark 的 hover 底色与展开态同层级，叠一层「展开 + hover」才不会悬停时闪回
  'dark:data-popup-open:hover:bg-popover',
  'data-popup-open:hover:border-input data-popup-open:focus-visible:border-input',
  'data-popup-open:data-[popup-side=bottom]:rounded-b-none!',
  'data-popup-open:data-[popup-side=top]:rounded-t-none!',
  'transition-[color,background-color,border-color,border-radius,box-shadow] duration-150 ease-[ease]'
)

export { ATTACHED_TRIGGER, FIELD_SHELL, OVERLAY_ELEVATION, OVERLAY_SHELL }
