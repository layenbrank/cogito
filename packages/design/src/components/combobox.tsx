import * as React from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import { FIELD_SHELL } from '../lib/surface'

const Combobox = ComboboxPrimitive.Root

/** 下拉箭头：与 Select 同款内联 SVG，展开旋转交给 data-popup-open */
function ComboboxChevron({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className={cn('pointer-events-none size-4 shrink-0', className)}>
      <path
        d="M4 6.25 8 10.25l4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 展开时触发器 / 输入壳与列表面板拼成同一张卡片：
 * 接缝侧去掉圆角与描边，并关掉 ring/阴影（它们是独立闭合框，会把「一个容器」切回两个）。
 * 方向必须叠在 popup-open 上：base-ui 关闭后仍保留 data-popup-side。
 */
const JOIN_TRIGGER = cn(
  'data-popup-open:border-ring data-popup-open:ring-0 data-popup-open:shadow-none',
  'data-popup-open:data-[popup-side=bottom]:rounded-b-none! data-popup-open:data-[popup-side=bottom]:border-b-transparent',
  'data-popup-open:data-[popup-side=top]:rounded-t-none! data-popup-open:data-[popup-side=top]:border-t-transparent',
  'transition-[color,background-color,border-color,border-radius,box-shadow] duration-150 ease-[ease]'
)

function ComboboxValue({ ...props }: ComboboxPrimitive.Value.Props) {
  return (
    <ComboboxPrimitive.Value
      data-slot="combobox-value"
      {...props}
    />
  )
}

/**
 * 可搜索 Select 触发器：外观对齐 SelectTrigger，展开时与面板拼成一张卡。
 * 典型用法：Trigger 显示当前值，Input 放进 Content。
 */
function ComboboxTrigger({
  className,
  size = 'default',
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      data-size={size}
      className={cn(
        FIELD_SHELL,
        JOIN_TRIGGER,
        'group/combobox-trigger flex w-fit cursor-pointer items-center justify-between gap-1.5 py-1.5 pr-2.5 pl-3 text-sm whitespace-nowrap select-none',
        'hover:border-ring disabled:cursor-not-allowed disabled:opacity-50',
        'data-placeholder:text-muted-foreground',
        'data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:pl-2.5',
        'dark:bg-input/30 dark:hover:bg-input/50',
        className
      )}
      {...props}>
      <span className="flex min-w-0 flex-1 truncate text-left">{children}</span>
      <ComboboxPrimitive.Icon
        data-slot="combobox-icon"
        className="flex shrink-0 text-muted-foreground transition-transform duration-150 ease-[ease] group-data-popup-open/combobox-trigger:rotate-180">
        <ComboboxChevron />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxClear({ className, ...props }: ComboboxPrimitive.Clear.Props) {
  return (
    <ComboboxPrimitive.Clear
      data-slot="combobox-clear"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-[calc(var(--radius)-3px)] text-muted-foreground outline-none hover:bg-muted hover:text-foreground disabled:pointer-events-none',
        className
      )}
      {...props}>
      <Icon
        icon="lucide:x"
        className="pointer-events-none size-3.5"
      />
    </ComboboxPrimitive.Clear>
  )
}

/**
 * 输入壳模式：Input 在触发器上直接过滤（Autocomplete 感）。
 * 壳用 Combobox.InputGroup，才能拿到 data-popup-open / data-popup-side 去拼卡片。
 * `size` 需与 ComboboxContent 一致，否则输入与选项字号会对不上。
 */
function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  showClear = false,
  size = 'default',
  ...props
}: Omit<ComboboxPrimitive.Input.Props, 'size'> & {
  showTrigger?: boolean
  showClear?: boolean
  /** 视觉尺寸；避开原生 input[size] 属性名冲突 */
  size?: 'sm' | 'default'
}) {
  const isSm = size === 'sm'
  return (
    <ComboboxPrimitive.InputGroup
      data-slot="combobox-input-group"
      data-size={size}
      className={cn(
        FIELD_SHELL,
        JOIN_TRIGGER,
        'group/combobox-input relative flex w-full min-w-0 items-center',
        isSm ? 'h-8 rounded-[min(var(--radius-md),10px)]' : 'h-9',
        'has-disabled:pointer-events-none has-disabled:opacity-50',
        'dark:bg-input/30',
        // 聚焦时不另画 ring：展开态已用 border-ring 勾勒整张卡
        'focus-within:border-ring focus-within:ring-0'
      )}>
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        disabled={disabled}
        className={cn(
          'h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
          'disabled:cursor-not-allowed',
          // sm：px-2 与 Content size=sm 的 list p-1 + item px-1 左缘对齐
          // default：px-3 与 list p-1 + item px-2 对齐（同 Select）
          isSm
            ? 'px-2 py-1 text-xs font-medium'
            : 'px-3 py-1 text-base md:text-sm',
          className
        )}
        {...props}
      />
      {showClear ? <ComboboxClear className={isSm ? 'size-5' : undefined} /> : null}
      {showTrigger ? (
        <ComboboxPrimitive.Trigger
          data-slot="combobox-input-trigger"
          disabled={disabled}
          className={cn(
            'mr-1 flex shrink-0 items-center justify-center rounded-[calc(var(--radius)-3px)] text-muted-foreground outline-none',
            isSm ? 'size-5' : 'size-6',
            'hover:bg-muted hover:text-foreground disabled:pointer-events-none',
            'group-has-data-[slot=combobox-clear]/combobox-input:hidden',
            'data-popup-open:[&_svg]:rotate-180 [&_svg]:transition-transform [&_svg]:duration-150'
          )}>
          <ComboboxChevron className={isSm ? 'size-3.5' : undefined} />
        </ComboboxPrimitive.Trigger>
      ) : null}
      {children}
    </ComboboxPrimitive.InputGroup>
  )
}

/**
 * 列表面板：与 SelectContent 同构——外层只做动效，内层画卡片壳并与触发器拼缝。
 * 默认 sideOffset=0，紧贴触发器下沿；显式传间距时保留间距、不吃掉 1px 边框。
 * `size` 传给弹层，Item / Empty 通过 group-data 继承字号，与 ComboboxInput 对齐。
 */
function ComboboxContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 0,
  align = 'start',
  alignOffset = 0,
  anchor,
  size = 'default',
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    'side' | 'align' | 'sideOffset' | 'alignOffset' | 'anchor'
  > & {
    size?: 'sm' | 'default'
  }) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-70">
        <ComboboxPrimitive.Popup
          data-slot="combobox-popup"
          data-size={size}
          className={cn(
            'group/combobox-content relative isolate z-70 flex w-(--anchor-width) flex-col origin-(--transform-origin)',
            'data-[side=bottom]:origin-top-left data-[side=top]:origin-bottom-left',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
            'data-[side=bottom]:slide-out-to-top-1 data-[side=top]:slide-out-to-bottom-1',
            'duration-150 transition-none'
          )}
          {...props}>
          <div
            data-slot="combobox-content"
            data-size={size}
            className={cn(
              // 必须与锚点（InputGroup / Trigger）严格等宽：
              // 多出 spacing 后靠右会触发碰撞避让，整块被推到左侧，接缝左右错开像「断裂」。
              'relative isolate w-(--anchor-width) max-w-(--available-width) overflow-hidden',
              'rounded-md border border-ring bg-popover text-popover-foreground outline-hidden',
              'group-data-[side=bottom]/combobox-content:rounded-t-none',
              'group-data-[side=top]/combobox-content:rounded-b-none',
              sideOffset === 0 &&
                'group-data-[side=bottom]/combobox-content:-mt-px group-data-[side=top]/combobox-content:-mb-px',
              // 面板内嵌搜索框（可搜索 Select）：顶部分隔，不另起一张卡
              '*:data-[slot=combobox-content-input]:border-b *:data-[slot=combobox-content-input]:border-border',
              className
            )}>
            {children}
          </div>
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

/** 放进 Content 顶部的搜索框：可搜索 Select 模式用 */
function ComboboxContentInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <div
      data-slot="combobox-content-input"
      className="relative px-1.5 pt-1.5 pb-1">
      <Icon
        icon="lucide:search"
        className="pointer-events-none absolute inset-s-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground opacity-50"
      />
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          'h-8 w-full rounded-md bg-input/30 pr-2.5 pl-8 text-sm outline-none placeholder:text-muted-foreground',
          className
        )}
        {...props}
      />
    </div>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn(
        'flex max-h-[min(16rem,var(--available-height,16rem))] flex-col gap-0.5 overflow-x-hidden overflow-y-auto p-1 scroll-smooth',
        'scroll-py-1 overscroll-auto',
        'scrollbar-none [&::-webkit-scrollbar]:hidden',
        'data-empty:p-0',
        className
      )}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        'relative flex w-full cursor-pointer items-center gap-2 rounded-md outline-hidden select-none',
        // default：text-sm；sm：跟 Input size=sm 的 text-xs，且 px-1 + list p-1 = 输入 px-2
        'min-h-8 px-2 py-1.5 text-sm',
        'group-data-[size=sm]/combobox-content:min-h-7 group-data-[size=sm]/combobox-content:px-1 group-data-[size=sm]/combobox-content:py-1 group-data-[size=sm]/combobox-content:text-xs',
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        'data-selected:bg-primary/10 data-selected:font-medium',
        'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      className={cn('scroll-my-1', className)}
      {...props}
    />
  )
}

function ComboboxLabel({
  className,
  ...props
}: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function ComboboxCollection({ ...props }: ComboboxPrimitive.Collection.Props) {
  return (
    <ComboboxPrimitive.Collection
      data-slot="combobox-collection"
      {...props}
    />
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn(
        // Empty 节点常驻 DOM（无障碍播报）；无文案时 :empty 隐藏，避免占位
        'w-full px-2 py-6 text-center text-sm text-muted-foreground empty:hidden empty:p-0',
        'group-data-[size=sm]/combobox-content:px-1 group-data-[size=sm]/combobox-content:py-4 group-data-[size=sm]/combobox-content:text-xs',
        className
      )}
      {...props}
    />
  )
}

function ComboboxSeparator({
  className,
  ...props
}: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function ComboboxChips({
  className,
  ...props
}: React.ComponentPropsWithRef<'div'> & ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        FIELD_SHELL,
        JOIN_TRIGGER,
        'flex min-h-9 w-full flex-wrap items-center gap-1 bg-clip-padding px-2.5 py-1 text-sm',
        'focus-within:border-ring focus-within:ring-0',
        'has-data-[slot=combobox-chip]:px-1.5',
        'dark:bg-input/30',
        className
      )}
      {...props}
    />
  )
}

function ComboboxChip({
  className,
  children,
  showRemove = true,
  ...props
}: ComboboxPrimitive.Chip.Props & {
  showRemove?: boolean
}) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn(
        'flex h-5 w-fit items-center justify-center gap-1 rounded-sm bg-muted px-1.5 text-xs font-medium whitespace-nowrap text-foreground',
        'has-disabled:pointer-events-none has-disabled:cursor-not-allowed has-disabled:opacity-50',
        'has-data-[slot=combobox-chip-remove]:pr-0',
        className
      )}
      {...props}>
      {children}
      {showRemove ? (
        <ComboboxPrimitive.ChipRemove
          data-slot="combobox-chip-remove"
          className="-ml-0.5 flex size-4 items-center justify-center rounded-sm opacity-50 outline-none hover:opacity-100">
          <Icon
            icon="lucide:x"
            className="pointer-events-none size-3"
          />
        </ComboboxPrimitive.ChipRemove>
      ) : null}
    </ComboboxPrimitive.Chip>
  )
}

function ComboboxChipsInput({
  className,
  ...props
}: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chip-input"
      className={cn('min-w-16 flex-1 bg-transparent outline-none', className)}
      {...props}
    />
  )
}

function useComboboxAnchor() {
  return React.useRef<HTMLDivElement | null>(null)
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxContent,
  ComboboxContentInput,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  useComboboxAnchor
}
