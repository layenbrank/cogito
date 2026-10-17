import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
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
import { ScrollArea } from '@i-thinking/design/components/scroll-area'

interface ToolbarYamlDialogProps {
  name: string
  open: boolean
  isLoading: boolean
  yamlText: string
  onOpenChange: (open: boolean) => void
}

function ToolbarYamlDialog(props: ToolbarYamlDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-3">
        <DialogHeader>
          <DialogTitle>YAML · {props.name}</DialogTitle>
          <DialogDescription>
            corex 落库的只读副本；未保存的本地修改不会出现在这里。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/30">
          <pre className="m-0 whitespace-pre-wrap wrap-break-word p-3 font-mono text-xs leading-5">
            {props.isLoading ? '读取中…' : props.yamlText || '（空）'}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

interface ToolbarDeleteDialogProps {
  name: string
  open: boolean
  isDeleting: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function ToolbarDeleteDialog(props: ToolbarDeleteDialogProps) {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{props.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            指令将从 corex 库中永久删除，无法在此恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.isDeleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.isDeleting}
            onClick={function (event) {
              event.preventDefault()
              props.onConfirm()
            }}>
            {props.isDeleting ? '删除中…' : '删除'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ToolbarYamlDialog, ToolbarDeleteDialog }
