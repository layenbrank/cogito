import type { ComponentProps } from 'react'

import { Select as SelectPrimitive } from '@base-ui/react/select'
import { cn } from 'cn'

import { FIELD_SHELL } from '../lib/surface'

const Select = SelectPrimitive.Root

/** 下拉箭头：内联 SVG，不引入图标库（尺寸/颜色/旋转全交给 className），也还原了触发器右侧箭头 */
function SelectChevron({ className }: { className?: string }) {
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

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn('scroll-my-1', className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn('flex min-w-0 flex-1 truncate text-left', className)}
      {...props}
    />
  )
}
function SelectTrigger({
  className,
  size = 'default',
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: 'sm' | 'default'
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        FIELD_SHELL,
        'group/select-trigger flex w-fit cursor-pointer items-center justify-between gap-1.5 py-1.5 pr-2.5 pl-3 text-sm whitespace-nowrap select-none',
        // 交互对齐 antd：悬停边框变主色；展开时只靠主色边框勾勒整个容器
        // （不能再给触发器单独画 ring——它是个闭合圆角矩形，会把“一个容器”切回两个）
        'hover:border-ring disabled:cursor-not-allowed disabled:opacity-50',
        // 展开时与列表面板拼成同一张卡片：接缝那一侧去掉圆角与描边，
        // 并去掉 ring/阴影（它们是独立的闭合框，会把“一个容器”切回两个）。
        // 方向必须叠加在 popup-open 之上：base-ui 关闭后仍保留 data-popup-side，
        // 只按 side 判断会让卡片收起后依然缺一角。
        'data-popup-open:border-ring data-popup-open:ring-0 data-popup-open:shadow-none',
        'data-popup-open:data-[popup-side=bottom]:rounded-b-none! data-popup-open:data-[popup-side=bottom]:border-b-transparent',
        'data-popup-open:data-[popup-side=top]:rounded-t-none! data-popup-open:data-[popup-side=top]:border-t-transparent',
        'data-placeholder:text-muted-foreground',
        // 圆角/描边随开合过渡，时长与曲线跟弹层入场/退场完全一致（150ms ease），
        // 否则接缝那一侧的圆角会“跳变”，看起来和弹层不是同一个动作。
        // （FIELD_SHELL 只声明了 color/box-shadow，这里整体接管 transition-property）
        'transition-[color,background-color,border-color,border-radius,box-shadow] duration-150 ease-[ease]',
        'data-[size=default]:h-9 data-[size=sm]:h-8 data-[size=sm]:rounded-[min(var(--radius-md),10px)] data-[size=sm]:pl-2.5',
        'dark:bg-input/30 dark:hover:bg-input/50',
        className
      )}
      {...props}>
      {children}
      {/* 用 base-ui 的 Icon（渲染 <span aria-hidden>，展开时自带 data-popup-open），旋转直接由它驱动 */}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        className="flex shrink-0 text-muted-foreground transition-transform duration-150 ease-[ease] data-popup-open:rotate-180">
        <SelectChevron />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 0,
  align = 'start',
  alignOffset = 0,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        // 卡片式展开依赖列表从触发器下沿开始；base-ui 的 Select 默认是 true（列表盖在触发器上），必须显式关掉
        alignItemWithTrigger={false}
        className="isolate z-70">
        {/* 透明外壳：动效挂在它身上（data-open/data-closed 由 base-ui 打在这里），自身不画背景/边框/阴影。 */}
        <SelectPrimitive.Popup
          data-slot="select-popup"
          className={cn(
            'group/popup relative isolate z-70 flex flex-col origin-(--transform-origin)',
            // 缩放原点固定到接缝侧的左边缘：面板与触发器严格等宽，左边缘恒重合，
            // 所以横向绝不产生位移（默认的 --transform-origin 在 align=center 时会停在中心，
            // 缩放过程中左边缘会往左跑几 px）
            'data-[side=bottom]:origin-top-left data-[side=top]:origin-bottom-left',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95',
            'data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            // 沿展开方向再滑 4px：配合 origin 在触发器边缘的缩放，读起来是“从触发器里长出来”
            'data-[side=bottom]:slide-in-from-top-1 data-[side=top]:slide-in-from-bottom-1',
            'data-[side=bottom]:slide-out-to-top-1 data-[side=top]:slide-out-to-bottom-1',
            // transition-none：避免 duration-* 让 top/left 也进入过渡（会看起来像从左上角飞入）
            'duration-150 transition-none'
          )}
          {...props}>
          <div
            data-slot="select-content"
            className={cn(
              // 面板不复用 OVERLAY_SHELL：那套 ring/阴影/四角圆角是给“独立浮层”的，
              // 拼进卡片时 ring 会在接缝处描出一条线，四角圆角也会跟触发器打架。
              // 这里只做「卡片外壳」：不滚，滚动交给里面的 List（base-ui 的滚动箭头按这个结构设计），
              // 所以外壳用 overflow-hidden + relative 去裁圆角、给箭头当定位基准。
              'relative isolate w-(--anchor-width) overflow-hidden p-1',
              'rounded-md border border-ring bg-popover text-popover-foreground outline-hidden',
              // 按实际展开方向拼容器：接缝那一侧不要圆角（边框保留，作为“触发器 / 列表”的分隔线）
              'group-data-[side=bottom]/popup:rounded-t-none',
              'group-data-[side=top]/popup:rounded-b-none',
              // 只有紧贴触发器（sideOffset = 0）时才用负边距吃掉触发器那 1px 边框；
              // 调用点显式给了间距就保留间距，别把卡片粘回触发器
              sideOffset === 0 &&
                'group-data-[side=bottom]/popup:-mt-px group-data-[side=top]/popup:-mb-px',
              className
            )}>
            <SelectScrollUpButton />
            <SelectPrimitive.List
              className={cn(
                'flex max-h-[min(16rem,var(--available-height,16rem))] flex-col gap-0.5 overflow-x-hidden overflow-y-auto scroll-smooth',
                // 键盘导航用 scrollIntoView({block:'nearest'})，scroll-padding 留出箭头高度（24px），
                // 否则高亮项会被顶/底那条滚动箭头盖住
                'scroll-py-6',
                // 隐藏滚动条：固定等宽时 6px 滚动条会把选项文字挤到截断
                'scrollbar-none [&::-webkit-scrollbar]:hidden'
              )}>
              {children}
            </SelectPrimitive.List>
            <SelectScrollDownButton />
          </div>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn('px-2 py-1.5 text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // px-2 + 面板 p-1 = 触发器 px-3，文字与触发器左对齐；同时给同宽容器留出足够的文本宽度
        'relative flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none',
        // antd 交互：悬停给中性底色；选中项用浅主色 + 中粗字重（不再画 check 图标）
        'data-highlighted:bg-accent data-highlighted:text-accent-foreground',
        'data-selected:bg-primary/10 data-selected:font-medium',
        'data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50',
        className
      )}
      {...props}>
      {/* 文本用块级 truncate：flex 容器上 text-overflow 不生效，长文案会硬切而不是省略号；
          选项图标若写在 ItemText 里，用子选择器补回间距 */}
      <SelectPrimitive.ItemText className="min-w-0 flex-1 truncate [&>svg]:mr-1.5 [&>svg]:inline-block [&>svg]:align-middle">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn('pointer-events-none -mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

/** 滚动箭头：只在列表可滚且非触摸操作时出现（base-ui 负责显隐），悬停即逐项滚动 */
function SelectScrollUpButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        'absolute inset-x-0 top-0 z-10 flex items-center justify-center bg-popover py-1 text-muted-foreground',
        className
      )}
      {...props}>
      <SelectChevron className="rotate-180" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex items-center justify-center bg-popover py-1 text-muted-foreground',
        className
      )}
      {...props}>
      <SelectChevron />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue
}
