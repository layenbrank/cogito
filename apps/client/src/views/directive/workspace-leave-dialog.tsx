import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@cogito/design/components/alert-dialog'

interface WorkspaceLeaveDialogProps {
  open: boolean
  onStay: () => void
  onLeave: () => void
}

function WorkspaceLeaveDialog(props: WorkspaceLeaveDialogProps) {
  return (
    <AlertDialog open={props.open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
          <AlertDialogDescription>
            当前指令有未保存修改，离开将丢失这些更改。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onStay}>留下</AlertDialogCancel>
          <AlertDialogAction onClick={props.onLeave}>离开</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { WorkspaceLeaveDialog }
