import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@i-thinking/design/components/alert-dialog'
import { Button } from '@i-thinking/design/components/button'
import { useState } from 'react'

interface ConfirmActionProps {
  label: string
  title: string
  description: string
  confirmLabel: string
  isPending?: boolean
  onConfirm: () => void | Promise<void>
}

/** 危险动作按钮 + 二次确认：调用方只关心文案与回调 */
function ConfirmAction(props: ConfirmActionProps) {
  const [isOpen, updateOpen] = useState(false)

  return (
    <>
      <Button
        variant="destructive"
        disabled={props.isPending}
        onClick={function () {
          updateOpen(true)
        }}>
        {props.label}
      </Button>
      <AlertDialog
        open={isOpen}
        onOpenChange={updateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{props.title}</AlertDialogTitle>
            <AlertDialogDescription>{props.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={function () {
                updateOpen(false)
                void props.onConfirm()
              }}>
              {props.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ConfirmAction }
export type { ConfirmActionProps }
