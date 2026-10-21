import { Button } from '@i-thinking/design/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@i-thinking/design/components/sheet'
import type { ReactNode } from 'react'

interface EntitySheetProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  submitLabel?: string
  isPending?: boolean
  onOpenChange(open: boolean): void
  onSubmit?(): void
}

function EntitySheet(props: EntitySheetProps) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          {props.description ? <SheetDescription>{props.description}</SheetDescription> : null}
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">{props.children}</div>
        {props.onSubmit ? (
          <SheetFooter>
            <Button
              variant="outline"
              disabled={props.isPending}
              onClick={function () {
                props.onOpenChange(false)
              }}>
              取消
            </Button>
            <Button
              disabled={props.isPending}
              onClick={props.onSubmit}>
              {props.submitLabel ?? '保存'}
            </Button>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export { EntitySheet }
