'use client'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { cn } from 'cn'

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      {...props}
    />
  )
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        // 打开播 collapsible-down（0 → 内容高），关闭切 collapsible-up（内容高 → 0）。
        // 大块内容（过程摘要）由消费者传 animate-none 覆盖；className 必须在后，方便 twMerge。
        'overflow-hidden motion-reduce:animate-none',
        'animate-collapsible-down data-ending-style:animate-collapsible-up',
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
