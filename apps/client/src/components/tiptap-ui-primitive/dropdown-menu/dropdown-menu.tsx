'use client'

import {
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type Ref
} from 'react'

import {
  DropdownMenu as DesignMenu,
  DropdownMenuContent as DesignContent,
  DropdownMenuGroup as DesignGroup,
  DropdownMenuItem as DesignItem,
  DropdownMenuPortal as DesignPortal,
  DropdownMenuRadioGroup as DesignRadioGroup,
  DropdownMenuSub as DesignSub,
  DropdownMenuSubContent as DesignSubContent,
  DropdownMenuSubTrigger as DesignSubTrigger,
  DropdownMenuTrigger as DesignTrigger
} from '@cogito/design/components/dropdown-menu'
import { cn } from '@/lib/tiptap-utils.ts'
import { findBubbleMenuContainer } from '@/components/tiptap-ui-primitive/bubble-portal.ts'
import { restoreComposerFocus } from '@/components/tiptap-ui-primitive/overlay-focus.ts'

interface MenuAnchorContextValue {
  anchor: HTMLElement | null
  bindAnchor: (node: HTMLElement | null) => void
}

const MenuAnchorContext = createContext<MenuAnchorContextValue | null>(null)

function asClassName(className: unknown): string | undefined {
  return typeof className === 'string' ? className : undefined
}

function assignTriggerRef(
  node: HTMLButtonElement | null,
  bindAnchor: ((node: HTMLElement | null) => void) | undefined,
  ref: Ref<HTMLButtonElement> | undefined
) {
  bindAnchor?.(node)
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  if (ref) {
    ref.current = node
  }
}

/**
 * TipTap 默认 modal=false，避免抢焦点塌选区；调用方可显式传 modal 覆盖。
 * 关闭完成后：若焦点落在 trigger / body，交回编辑器（避免蓝环 + Tooltip）。
 */
function DropdownMenu({
  modal = false,
  onOpenChangeComplete,
  ...props
}: ComponentPropsWithoutRef<typeof DesignMenu>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <MenuAnchorContext.Provider
      value={{
        anchor,
        bindAnchor: setAnchor
      }}>
      <DesignMenu
        {...props}
        modal={modal}
        onOpenChangeComplete={function (open) {
          onOpenChangeComplete?.(open)
          if (!open) restoreComposerFocus(anchor)
        }}
      />
    </MenuAnchorContext.Provider>
  )
}

function DropdownMenuPortal(props: ComponentPropsWithoutRef<typeof DesignPortal>) {
  return <DesignPortal {...props} />
}

const DropdownMenuTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof DesignTrigger> & { asChild?: boolean }
>(function DropdownMenuTrigger({ asChild, children, ...props }, ref) {
  const ctx = useContext(MenuAnchorContext)
  if (asChild && isValidElement(children)) {
    return (
      <DesignTrigger
        ref={function (node) {
          assignTriggerRef(node, ctx?.bindAnchor, ref)
        }}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <DesignTrigger
      ref={function (node) {
        assignTriggerRef(node, ctx?.bindAnchor, ref)
      }}
      {...props}>
      {children}
    </DesignTrigger>
  )
})

const DropdownMenuGroup = DesignGroup
const DropdownMenuSub = DesignSub
const DropdownMenuRadioGroup = DesignRadioGroup

/**
 * TipTap 菜单项 asChild 一律落到原生 button 元素（Button / HeadingButton 等）。
 * Base UI Menu.Item / SubmenuTrigger 默认 nativeButton=false（期望 div），
 * 不声明会刷屏警告并混入非原生属性。调用方仍可显式传 nativeButton 覆盖。
 */
function resolveAsChildNativeButton(
  nativeButton: boolean | undefined
): boolean {
  return nativeButton ?? true
}

const DropdownMenuItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DesignItem> & { asChild?: boolean }
>(function DropdownMenuItem(
  { asChild, children, className, nativeButton, ...props },
  ref
) {
  const itemClass = cn('w-full justify-start', asClassName(className))
  if (asChild && isValidElement(children)) {
    return (
      <DesignItem
        ref={ref}
        className={itemClass}
        {...props}
        render={children as ReactElement}
        nativeButton={resolveAsChildNativeButton(nativeButton)}
      />
    )
  }
  return (
    <DesignItem
      ref={ref}
      className={itemClass}
      {...props}
      nativeButton={nativeButton}>
      {children}
    </DesignItem>
  )
})

const DropdownMenuSubTrigger = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DesignSubTrigger> & { asChild?: boolean }
>(function DropdownMenuSubTrigger(
  { asChild, children, nativeButton, ...props },
  ref
) {
  if (asChild && isValidElement(children)) {
    return (
      <DesignSubTrigger
        ref={ref}
        {...props}
        render={children as ReactElement}
        nativeButton={resolveAsChildNativeButton(nativeButton)}
      />
    )
  }
  return (
    <DesignSubTrigger
      ref={ref}
      {...props}
      nativeButton={nativeButton}>
      {children}
    </DesignSubTrigger>
  )
})

const DropdownMenuSubContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DesignSubContent> & { portal?: boolean | object }
>(function DropdownMenuSubContent({ className, portal: _portal, ...props }, ref) {
  return (
    <DesignSubContent
      ref={ref}
      className={cn('w-max! min-w-0', asClassName(className))}
      {...props}
    />
  )
})

const DropdownMenuContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof DesignContent> & { portal?: boolean }
>(function DropdownMenuContent(
  { className, sideOffset = 4, portal = true, finalFocus, ...props },
  ref
) {
  const ctx = useContext(MenuAnchorContext)
  const useBodyPortal = portal === true
  // portal=false：从触发点 closest 气泡节点；有则挂 container，避免回退 body 导致气泡闪退
  const bubble = useBodyPortal ? null : findBubbleMenuContainer(ctx?.anchor)
  return (
    <DesignContent
      ref={ref}
      sideOffset={sideOffset}
      portal={useBodyPortal}
      container={useBodyPortal ? undefined : (bubble ?? undefined)}
      className={cn(
        // 覆盖 design 的 w-(--anchor-width) / min-w-32，按内容收窄并左缘对齐
        'w-max! min-w-0 p-1',
        asClassName(className)
      )}
      {...props}
      // 默认不回 trigger（避免蓝环 + Tooltip）；关闭后由 Root 的 restoreComposerFocus 交回编辑器
      finalFocus={finalFocus ?? false}
    />
  )
})

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup
}
