import { cn } from 'cn'
import * as React from 'react'

import { FOCUS_WITHIN } from '../lib/focus'
import { FIELD_SHELL } from '../lib/surface'

/**
 * 原生 `<select>` 的壳：用系统下拉（移动端与无障碍更稳），观感对齐 Input。
 *
 * 与 `Select`（自定义浮层）的分工：这个没有 Portal、没有搜索、没有自定义项渲染，纯系统行为；
 * 选项需要图标 / 多选 / 搜索时用 `Select`。
 *
 * 不画箭头：与 `Select` 保持一致（视觉反馈交给边框 / focus 环 / 系统光标）。
 *
 * ⚠️ 展开后的选项列表由系统控件渲染（WebView2 / Chromium 用原生下拉），
 * 圆角、内边距、悬停底色、字体都改不了；只有 `option` 的 background-color / color 在部分引擎生效。
 * 要「与设计系统完全一致 + 出入场动效」的浮层，必须用 `Select`。
 */
const SELECT_SHELL = cn(
  // FIELD_SHELL：白底 + 1px 边框 + 轻阴影 + 全局 focus 环观感
  FIELD_SHELL,
  // 原生 select 用鼠标点开也会拿到焦点，focus-within 比 focus-visible 更符合「点开就有反馈」
  FOCUS_WITHIN,
  'h-9 w-full min-w-0 cursor-pointer appearance-none px-3 py-1 text-base select-none md:text-sm',
  'hover:bg-muted/40 dark:bg-input/30 dark:hover:bg-input/50'
)

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'size'> & {
  size?: 'sm' | 'default'
}

function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      data-size={size}
      className={cn('relative w-fit has-[select:disabled]:opacity-50', className)}>
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          SELECT_SHELL,
          'data-[size=sm]:h-8 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:px-2.5 data-[size=sm]:text-sm',
          'disabled:pointer-events-none disabled:cursor-not-allowed'
        )}
        {...props}
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<'option'>) {
  return (
    <option
      data-slot="native-select-option"
      className={cn('bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<'optgroup'>) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn('bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
export type { NativeSelectProps }
