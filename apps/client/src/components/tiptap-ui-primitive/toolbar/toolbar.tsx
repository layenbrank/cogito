'use client'

import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@cogito/design/components/tooltip'
import { Separator } from '@/components/tiptap-ui-primitive/separator/separator.tsx'
import { cn } from '@/lib/tiptap-utils.ts'
import { useMenuNavigation } from '@/hooks/use-menu-navigation.ts'
import { useComposedRef } from '@/hooks/use-composed-ref.ts'

type BaseProps = React.HTMLAttributes<HTMLDivElement>

interface ToolbarProps extends BaseProps {
  variant?: 'floating' | 'fixed'
}

function useToolbarNavigation(toolbarRef: React.RefObject<HTMLDivElement | null>) {
  const [items, setItems] = useState<HTMLElement[]>([])

  const collectItems = useCallback(
    function () {
      if (!toolbarRef.current) return []
      return Array.from(
        toolbarRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [role="button"]:not([disabled]), [tabindex="0"]:not([disabled])'
        )
      )
    },
    [toolbarRef]
  )

  useEffect(
    function () {
      const toolbar = toolbarRef.current
      if (!toolbar) return
      function updateItems() {
        setItems(collectItems())
      }
      updateItems()
      const observer = new MutationObserver(updateItems)
      observer.observe(toolbar, { childList: true, subtree: true })
      return function () {
        observer.disconnect()
      }
    },
    [collectItems, toolbarRef]
  )

  const { selectedIndex } = useMenuNavigation<HTMLElement>({
    containerRef: toolbarRef,
    items,
    orientation: 'horizontal',
    onSelect: function (el) {
      el.click()
    },
    autoSelectFirstItem: false
  })

  useEffect(
    function () {
      const toolbar = toolbarRef.current
      if (!toolbar) return
      function handleFocus(e: FocusEvent) {
        const target = e.target as HTMLElement
        if (toolbar.contains(target)) target.setAttribute('data-focus-visible', 'true')
      }
      function handleBlur(e: FocusEvent) {
        const target = e.target as HTMLElement
        if (toolbar.contains(target)) target.removeAttribute('data-focus-visible')
      }
      toolbar.addEventListener('focus', handleFocus, true)
      toolbar.addEventListener('blur', handleBlur, true)
      return function () {
        toolbar.removeEventListener('focus', handleFocus, true)
        toolbar.removeEventListener('blur', handleBlur, true)
      }
    },
    [toolbarRef]
  )

  useEffect(
    function () {
      if (selectedIndex !== undefined && items[selectedIndex]) {
        items[selectedIndex].focus()
      }
    },
    [selectedIndex, items]
  )
}

export const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(function Toolbar(
  { children, className, variant = 'fixed', ...props },
  ref
) {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const composedRef = useComposedRef(toolbarRef, ref)
  useToolbarNavigation(toolbarRef)

  return (
    <TooltipProvider delay={200}>
      <div
        ref={composedRef}
        role="toolbar"
        aria-label="工具栏"
        data-variant={variant}
        className={cn(
          'flex items-center gap-0.5',
          variant === 'floating' &&
            'rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md',
          className
        )}
        {...props}>
        {children}
      </div>
    </TooltipProvider>
  )
})
Toolbar.displayName = 'Toolbar'

export const ToolbarGroup = forwardRef<HTMLDivElement, BaseProps>(function ToolbarGroup(
  { children, className, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      role="group"
      className={cn('flex items-center gap-0.5', className)}
      {...props}>
      {children}
    </div>
  )
})
ToolbarGroup.displayName = 'ToolbarGroup'

export const ToolbarSeparator = forwardRef<HTMLDivElement, BaseProps>(
  function ToolbarSeparator(props, ref) {
    return (
      <Separator
        ref={ref}
        orientation="vertical"
        decorative
        {...props}
      />
    )
  }
)
ToolbarSeparator.displayName = 'ToolbarSeparator'
