import * as React from 'react'
import { createPortal } from 'react-dom'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from 'cn'

import { Button } from '@cogito/design/components/button'
import { useOverlayPortalContainer } from '@cogito/design/components/overlay-portal'
import { Icon } from '@iconify/react/offline'
import {
  findOverlaySideClass,
  OVERLAY_BACKDROP_MOTION,
  type OverlaySide
} from '../lib/overlay-motion'
import { OVERLAY_ELEVATION } from '../lib/surface'
import { webviewCoverProps } from '../lib/webview-cover'

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      {...props}
    />
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      {...props}
    />
  )
}

function DialogPortal({ container, ...props }: DialogPrimitive.Portal.Props) {
  const shellContainer = useOverlayPortalContainer()
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      container={container ?? shellContainer ?? undefined}
      {...props}
    />
  )
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      {...props}
    />
  )
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  const shellContainer = useOverlayPortalContainer()
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        // 有壳容器时 absolute，避免盖住窗口操作栏；否则 fixed 全窗
        shellContainer ? 'absolute inset-0' : 'fixed inset-0',
        'isolate z-50 bg-black/10 supports-backdrop-filter:backdrop-blur-xs',
        OVERLAY_BACKDROP_MOTION,
        className
      )}
      {...props}
    />
  )
}

interface DialogSlotsContextValue {
  headerTarget: HTMLElement | null
  footerTarget: HTMLElement | null
}

const DialogSlotsContext = React.createContext<DialogSlotsContextValue | null>(null)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  side = 'center',
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /** 覆盖遮罩样式（如登录弹窗需要更强 scrim） */
  overlayClassName?: string
  /**
   * 弹出方位。`center` 为缩放进出；贴边为滑入滑出。
   * 动效在 design 内一等公民实现，业务侧不要再用 className 覆盖 translate/scale。
   */
  side?: OverlaySide
}) {
  const [headerTarget, updateHeaderTarget] = React.useState<HTMLElement | null>(null)
  const [footerTarget, updateFooterTarget] = React.useState<HTMLElement | null>(null)
  const shellContainer = useOverlayPortalContainer()

  const slots = React.useMemo<DialogSlotsContextValue>(
    function () {
      return { headerTarget, footerTarget }
    },
    [headerTarget, footerTarget]
  )

  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        data-side={side}
        {...webviewCoverProps()}
        className={cn(
          // 圆角裁切在外壳；Header/Footer 挂到滚动区外，避免滚动条压到关闭按钮、Footer -mx-4 撑出横向滚动
          shellContainer ? 'absolute' : 'fixed',
          'z-50 flex flex-col gap-0 overflow-hidden bg-popover p-4 text-sm text-popover-foreground outline-none',
          OVERLAY_ELEVATION,
          side === 'center' && 'rounded-xl',
          findOverlaySideClass(side),
          className
        )}
        {...props}>
        <DialogSlotsContext.Provider value={slots}>
          <div
            data-slot="dialog-header-slot"
            className="shrink-0"
            ref={updateHeaderTarget}
          />
          <div
            data-slot="dialog-body"
            // px 留给 focus ring：overflow-y:auto 时 overflow-x 也会变成可裁切，
            // 贴边 Input 的 ring 会被左右切掉（看板卡片详情即此例）
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-1 pb-4">
            {children}
          </div>
          <div
            data-slot="dialog-footer-slot"
            className="shrink-0"
            ref={updateFooterTarget}
          />
        </DialogSlotsContext.Provider>
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2 z-10"
                size="icon-sm"
              />
            }>
            <Icon icon="lucide:x" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const slots = React.useContext(DialogSlotsContext)

  const header = (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 pr-8 pb-4', className)}
      {...props}
    />
  )

  if (slots) {
    if (!slots.headerTarget) return null
    return createPortal(header, slots.headerTarget)
  }

  return header
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  const slots = React.useContext(DialogSlotsContext)

  const footer = (
    <div
      data-slot="dialog-footer"
      className={cn(
        '-mx-4 -mb-4 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end',
        className
      )}
      {...props}>
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
      )}
    </div>
  )

  // 有 slots 时挂到滚动区外的 slot；slot 尚未挂载时先不渲染，避免进滚动容器触发横向溢出
  if (slots) {
    if (!slots.footerTarget) return null
    return createPortal(footer, slots.footerTarget)
  }

  return footer
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-medium', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
export type { OverlaySide as DialogSide }
