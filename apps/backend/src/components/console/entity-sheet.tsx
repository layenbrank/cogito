import { Button } from '@i-thinking/design/components/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@i-thinking/design/components/sheet'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface EntitySheetProps {
  open: boolean
  title: string
  description?: string
  children: ReactNode
  /** 自定义底栏（详情只读删除等）；与 onSubmit 互斥优先 footer */
  footer?: ReactNode
  submitLabel?: string
  isPending?: boolean
  /** 覆盖 SheetContent 宽度等，例如详情页加宽 */
  contentClassName?: string
  onOpenChange(open: boolean): void
  onSubmit?(): void
}

function EntitySheet(props: EntitySheetProps) {
  const hasSubmit = typeof props.onSubmit === 'function'
  const hasFooter = Boolean(props.footer) || hasSubmit

  return (
    <Sheet
      open={props.open}
      onOpenChange={function (open) {
        props.onOpenChange(open)
      }}>
      <SheetContent
        side="right"
        className={clsx('flex w-full flex-col sm:max-w-md', props.contentClassName)}>
        <SheetHeader>
          <SheetTitle className="text-lg">{props.title}</SheetTitle>
          {props.description ? (
            <SheetDescription className="text-sm">{props.description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 py-4">{props.children}</div>
        {hasFooter ? (
          <SheetFooter>
            {props.footer ? (
              props.footer
            ) : (
              <>
                <Button
                  variant="outline"
                  className="h-10 px-4"
                  disabled={props.isPending}
                  onClick={function () {
                    props.onOpenChange(false)
                  }}>
                  取消
                </Button>
                <Button
                  className="h-10 px-4"
                  disabled={props.isPending}
                  onClick={function () {
                    props.onSubmit?.()
                  }}>
                  {props.submitLabel ?? '保存'}
                </Button>
              </>
            )}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export { EntitySheet }
