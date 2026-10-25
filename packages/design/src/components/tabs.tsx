'use client'

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

function Tabs({ className, orientation = 'horizontal', ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list relative inline-flex w-fit items-center justify-center rounded-lg p-1 text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none data-[variant=line]:p-0',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent'
      },
      /** 与 Input / SelectTrigger 同档：default=h-9，lg=h-11 对齐 AuthField */
      size: {
        sm: 'group-data-horizontal/tabs:h-8',
        default: 'group-data-horizontal/tabs:h-9',
        lg: 'group-data-horizontal/tabs:h-11 rounded-md'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function TabsList({
  className,
  variant = 'default',
  size = 'default',
  children,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      data-size={size}
      className={cn(tabsListVariants({ variant, size }), className)}
      {...props}>
      <TabsIndicator />
      {children}
    </TabsPrimitive.List>
  )
}

/**
 * 跟随当前 Tab 的滑动激活块（Base UI CSS 变量驱动）。
 * 默认变体为 pill；line 变体为底边指示条。
 * 位移走 translate，避免 left/top 触发布局重算。
 */
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        'pointer-events-none absolute top-0 left-0 z-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) transition-[translate,width,height] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none in-data-[motion=reduce]:transition-none',
        'rounded-md border border-input bg-background shadow-xs',
        'dark:border-input dark:bg-input/30',
        'group-data-[variant=line]/tabs-list:top-auto group-data-[variant=line]/tabs-list:right-auto group-data-[variant=line]/tabs-list:bottom-0 group-data-[variant=line]/tabs-list:left-0 group-data-[variant=line]/tabs-list:h-0.5 group-data-[variant=line]/tabs-list:w-(--active-tab-width) group-data-[variant=line]/tabs-list:translate-x-(--active-tab-left) group-data-[variant=line]/tabs-list:translate-y-0 group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:border-0 group-data-[variant=line]/tabs-list:bg-foreground group-data-[variant=line]/tabs-list:shadow-none dark:group-data-[variant=line]/tabs-list:bg-foreground',
        'group-data-vertical/tabs:group-data-[variant=line]/tabs-list:top-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:right-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:bottom-auto group-data-vertical/tabs:group-data-[variant=line]/tabs-list:left-auto group-data-vertical/tabs:group-data-[variant=line]/tabs-list:h-(--active-tab-height) group-data-vertical/tabs:group-data-[variant=line]/tabs-list:w-0.5 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:translate-x-0 group-data-vertical/tabs:group-data-[variant=line]/tabs-list:translate-y-(--active-tab-top)',
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative z-10 inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:hover:text-foreground data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsIndicator, tabsListVariants }
