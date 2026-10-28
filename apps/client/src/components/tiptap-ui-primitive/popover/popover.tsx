'use client'

import {
  createContext,
  isValidElement,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement
} from 'react'

import {
  Popover as DesignPopover,
  PopoverContent as DesignContent,
  PopoverTrigger as DesignTrigger
} from '@cogito/design/components/popover'
import { cn } from '@/lib/tiptap-utils.ts'
import { findBubbleMenuContainer } from '@/components/tiptap-ui-primitive/bubble-portal.ts'
import { restoreComposerFocus } from '@/components/tiptap-ui-primitive/overlay-focus.ts'

interface PopoverAnchorContextValue {
  anchor: HTMLElement | null
  bindAnchor: (node: HTMLElement | null) => void
}

const PopoverAnchorContext = createContext<PopoverAnchorContextValue | null>(null)

function asClassName(className: unknown): string | undefined {
  return typeof className === 'string' ? className : undefined
}

/**
 * 关闭完成后：若焦点落在 trigger / body，交回编辑器（避免蓝环 + Tooltip）。
 */
function Popover({
  onOpenChangeComplete,
  ...props
}: ComponentPropsWithoutRef<typeof DesignPopover>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <PopoverAnchorContext.Provider
      value={{
        anchor,
        bindAnchor: setAnchor
      }}>
      <DesignPopover
        {...props}
        onOpenChangeComplete={function (open) {
          onOpenChangeComplete?.(open)
          if (!open) restoreComposerFocus(anchor)
        }}
      />
    </PopoverAnchorContext.Provider>
  )
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof DesignTrigger> & { asChild?: boolean }) {
  const ctx = useContext(PopoverAnchorContext)
  if (asChild && isValidElement(children)) {
    return (
      <DesignTrigger
        ref={ctx?.bindAnchor}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <DesignTrigger
      ref={ctx?.bindAnchor}
      {...props}>
      {children}
    </DesignTrigger>
  )
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  portal = true,
  finalFocus,
  ...props
}: ComponentPropsWithoutRef<typeof DesignContent> & { portal?: boolean }) {
  const ctx = useContext(PopoverAnchorContext)
  const useBodyPortal = portal !== false
  // portal=false：从触发点 closest 气泡节点；有则挂 container，避免回退 body 导致气泡闪退
  const bubble = useBodyPortal ? null : findBubbleMenuContainer(ctx?.anchor)
  return (
    <DesignContent
      align={align}
      sideOffset={sideOffset}
      portal={useBodyPortal}
      container={useBodyPortal ? undefined : (bubble ?? undefined)}
      className={cn(
        // 覆盖 design 默认 w-72，按内容收窄；菜单/色板左缘对齐
        'w-max! min-w-0 gap-0 p-1',
        asClassName(className)
      )}
      {...props}
      // 默认不回 trigger（避免蓝环 + Tooltip）；关闭后由 Root 的 restoreComposerFocus 交回编辑器
      finalFocus={finalFocus ?? false}
    />
  )
}

export { Popover, PopoverTrigger, PopoverContent }
