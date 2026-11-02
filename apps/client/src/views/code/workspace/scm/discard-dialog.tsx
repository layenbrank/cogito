/**
 * 撤销 / 删除确认框：SCM 面板与 Agent 审阅面板共用。
 * 触发方只负责给出待撤销的路径集合。
 */
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

interface DiscardTarget {
  paths: string[]
  isUntracked: boolean
  label: string
}

interface DiscardDialogProps {
  target: DiscardTarget | null
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

function toDiscardTarget(paths: string[], isUntracked: boolean): DiscardTarget {
  return {
    paths,
    isUntracked,
    label: paths.length === 1 ? paths[0] : `${paths.length} 个文件`
  }
}

function DiscardDialog(props: DiscardDialogProps) {
  return (
    <AlertDialog
      open={props.target !== null}
      onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.target?.isUntracked ? '删除未跟踪文件？' : '撤销这些更改？'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {props.target?.label}
            {props.target?.isUntracked
              ? ' 删除后无法恢复。'
              : ' 未保存到暂存区的修改会丢失，且无法恢复。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>继续</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DiscardDialog, toDiscardTarget }
export type { DiscardDialogProps, DiscardTarget }
