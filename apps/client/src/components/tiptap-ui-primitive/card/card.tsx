'use client'

import { forwardRef } from 'react'
import { cn } from '@/lib/tiptap-utils.ts'

type CardProps = React.ComponentProps<'div'> & {
  /**
   * 独立浮层（Slash / Emoji 等，外层无 Popover/Dropdown 壳）时加边框阴影。
   * 嵌在 design PopoverContent / DropdownMenuContent 内时勿开，否则双层容器。
   */
  surface?: boolean
}

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, surface = false, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        surface &&
          'rounded-lg border border-border bg-popover text-popover-foreground shadow-md',
        className
      )}
      {...props}
    />
  )
})
Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(function CardHeader(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-1 border-b border-border px-2 py-1.5', className)}
      {...props}
    />
  )
})
CardHeader.displayName = 'CardHeader'

const CardBody = forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(function CardBody(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('flex flex-col gap-0.5 p-0.5', className)}
      {...props}
    />
  )
})
CardBody.displayName = 'CardBody'

const CardItemGroup = forwardRef<
  HTMLDivElement,
  React.ComponentProps<'div'> & { orientation?: 'horizontal' | 'vertical' }
>(function CardItemGroup({ className, orientation = 'vertical', ...props }, ref) {
  return (
    <div
      ref={ref}
      data-orientation={orientation}
      className={cn(
        'flex gap-0.5',
        orientation === 'horizontal' ? 'flex-row items-center' : 'flex-col',
        className
      )}
      {...props}
    />
  )
})
CardItemGroup.displayName = 'CardItemGroup'

const CardGroupLabel = forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  function CardGroupLabel({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('px-2 py-1 text-xs font-medium text-muted-foreground', className)}
        {...props}
      />
    )
  }
)
CardGroupLabel.displayName = 'CardGroupLabel'

const CardFooter = forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(function CardFooter(
  { className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn('flex items-center gap-1 border-t border-border px-2 py-1.5', className)}
      {...props}
    />
  )
})
CardFooter.displayName = 'CardFooter'

export { Card, CardHeader, CardFooter, CardBody, CardItemGroup, CardGroupLabel }
