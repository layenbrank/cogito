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

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  isPending?: boolean
  destructive?: boolean
  onOpenChange(open: boolean): void
  onConfirm(): void
}

function ConfirmDialog(props: ConfirmDialogProps) {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.isPending}>
            {props.cancelLabel ?? '取消'}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={props.destructive ? 'destructive' : 'default'}
            disabled={props.isPending}
            onClick={function (event) {
              event.preventDefault()
              props.onConfirm()
            }}>
            {props.confirmLabel ?? '确认'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ConfirmDialog }
export type { ConfirmDialogProps }
