import * as React from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from 'cn'

import { OVERLAY_SHELL } from '../lib/surface'

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
  return (
    <PopoverPrimitive.Root
      data-slot="popover"
      {...props}
    />
  )
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger
      data-slot="popover-trigger"
      {...props}
    />
  )
}

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  /** false：Portal 挂到 container（BubbleMenu 内须保持焦点在菜单树内） */
  portal = true,
  container,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'> & {
    portal?: boolean
    container?: HTMLElement | null
  }) {
  const positioned = (
    <PopoverPrimitive.Positioner
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className="isolate z-50">
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        className={cn(
          OVERLAY_SHELL,
          'z-50 flex w-72 origin-(--transform-origin) flex-col gap-2.5 p-2.5 text-sm',
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Positioner>
  )
  // Base UI：Positioner 必须在 Portal 上下文内，绝不可裸渲染。
  // portal=true → body；portal=false → 有 container 挂气泡，无则仍 Portal（默认 body）。
  if (portal) {
    return <PopoverPrimitive.Portal>{positioned}</PopoverPrimitive.Portal>
  }
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      {positioned}
    </PopoverPrimitive.Portal>
  )
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-0.5 text-sm', className)}
      {...props}
    />
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('font-medium', className)}
      {...props}
    />
  )
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger }
