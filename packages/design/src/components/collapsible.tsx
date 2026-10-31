'use client'

import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible'
import { cn } from 'cn'
import type { Ref } from 'react'

function Collapsible({
  ref,
  ...props
}: CollapsiblePrimitive.Root.Props & { ref?: Ref<HTMLElement> }) {
  return (
    <CollapsiblePrimitive.Root
      ref={ref}
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

/**
 * 用 height CSS transition（Base UI 推荐），不用 keyframe 高度动画。
 * keyframe 关合时 `--collapsible-panel-height` 与子层淡出/滚动锁叠在一起会严重抖动。
 */
function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        'overflow-hidden',
        'h-(--collapsible-panel-height)',
        'transition-[height] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)]',
        'data-starting-style:h-0 data-ending-style:h-0',
        'motion-reduce:transition-none',
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
