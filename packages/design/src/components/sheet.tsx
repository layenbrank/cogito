/**
 * Sheet：贴边抽屉语义封装，动效与 Dialog `side` 同源（`overlay-motion`）。
 * 默认从右侧滑入；需要其它边时传 `side`。
 */
import * as React from 'react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  type DialogSide
} from '@i-thinking/design/components/dialog'

function Sheet(props: React.ComponentProps<typeof Dialog>) {
  return (
    <Dialog
      data-slot="sheet"
      {...props}
    />
  )
}

function SheetTrigger(props: React.ComponentProps<typeof DialogTrigger>) {
  return (
    <DialogTrigger
      data-slot="sheet-trigger"
      {...props}
    />
  )
}

function SheetClose(props: React.ComponentProps<typeof DialogClose>) {
  return (
    <DialogClose
      data-slot="sheet-close"
      {...props}
    />
  )
}

function SheetPortal(props: React.ComponentProps<typeof DialogPortal>) {
  return (
    <DialogPortal
      data-slot="sheet-portal"
      {...props}
    />
  )
}

function SheetOverlay(props: React.ComponentProps<typeof DialogOverlay>) {
  return (
    <DialogOverlay
      data-slot="sheet-overlay"
      {...props}
    />
  )
}

function SheetContent({
  side = 'right',
  ...props
}: React.ComponentProps<typeof DialogContent> & {
  side?: Exclude<DialogSide, 'center'>
}) {
  return (
    <DialogContent
      data-slot="sheet-content"
      side={side}
      {...props}
    />
  )
}

function SheetHeader(props: React.ComponentProps<typeof DialogHeader>) {
  return (
    <DialogHeader
      data-slot="sheet-header"
      {...props}
    />
  )
}

function SheetFooter(props: React.ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      data-slot="sheet-footer"
      {...props}
    />
  )
}

function SheetTitle(props: React.ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      data-slot="sheet-title"
      {...props}
    />
  )
}

function SheetDescription(props: React.ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      data-slot="sheet-description"
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger
}
export type { DialogSide as SheetSide }
