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

/**
 * 列表里删指令的确认：与编辑器文案对齐。
 * 打开时由外层持有 `name`；关掉（取消 / 背景）走 `onCancel`。
 */

interface Props {
  name: string | null
  isDeleting: boolean
  onCancel: () => void
  onConfirm: () => void
}

function DirectiveDeleteDialog(props: Props) {
  const name = props.name ?? ''

  return (
    <AlertDialog
      open={props.name !== null}
      onOpenChange={function (isOpen) {
        if (!isOpen && !props.isDeleting) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            指令库里这一条会被删掉，删掉后无法从 Studio 恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={props.isDeleting}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={props.isDeleting}
            onClick={function (event) {
              // 交给外层异步删；先挡住默认关窗，等成功后再清 name
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

export { DirectiveDeleteDialog }
