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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import { Input } from '@i-thinking/design/components/input'

import type { AiSession } from '@/stores/agent.ts'

interface SidebarRenameDialogProps {
  open: boolean
  value: string
  onValueChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}

function SidebarRenameDialog(props: SidebarRenameDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>重命名会话</DialogTitle>
          <DialogDescription className="sr-only">修改会话标题</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={props.value}
          onChange={function (event) {
            props.onValueChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') props.onConfirm()
          }}
        />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={props.onClose}>
            取消
          </Button>
          <Button onClick={props.onConfirm}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface SidebarRemoveDialogProps {
  session: AiSession | null
  onClose: () => void
  onConfirm: () => void
}

function SidebarRemoveDialog(props: SidebarRemoveDialogProps) {
  return (
    <AlertDialog
      open={props.session !== null}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>移除会话</AlertDialogTitle>
          <AlertDialogDescription>
            {`确定移除「${props.session?.title ?? ''}」？此操作不可恢复。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={props.onConfirm}>
            移除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { SidebarRenameDialog, SidebarRemoveDialog }
