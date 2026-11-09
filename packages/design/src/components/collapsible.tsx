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

interface CollapsibleContentProps extends CollapsiblePrimitive.Panel.Props {
  /**
   * 关掉面板的高度过渡。
   *
   * 默认的 `transition-[height] duration-[220ms]` 在内容上千行时，每帧都要重排
   * 整个面板（展开 `node_modules` 这类目录足以按住主线程）；文件树这种「展开即
   * 铺开大量行」的场景直接不要动画，chevron 旋转仍然保留。
   */
  disableAnimation?: boolean
}

/**
 * 用 height CSS transition（Base UI 推荐），不用 keyframe 高度动画。
 * keyframe 关合时 `--collapsible-panel-height` 与子层淡出/滚动锁叠在一起会严重抖动。
 */
function CollapsibleContent({
  className,
  disableAnimation = false,
  ...props
}: CollapsibleContentProps) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      data-animation={disableAnimation ? 'none' : 'height'}
      className={cn(
        'overflow-hidden',
        'h-(--collapsible-panel-height)',
        disableAnimation
          ? 'transition-none'
          : 'transition-[height] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        'data-starting-style:h-0 data-ending-style:h-0',
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
