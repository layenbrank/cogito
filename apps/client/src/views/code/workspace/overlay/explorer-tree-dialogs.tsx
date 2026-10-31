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
import { Input } from '@cogito/design/components/input'

import type { ExplorerDeleteTarget } from '@/views/code/workspace/overlay/explorer-tree-lib.ts'

function DeleteConfirmDialog(props: {
  target: ExplorerDeleteTarget | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const target = props.target
  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={function (open) {
        if (!open) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.isDirectory ? '删除此文件夹及其内容？' : '删除此文件？'}
          </AlertDialogTitle>
          <AlertDialogDescription>{target?.absolute}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function NameDialog(props: {
  title: string
  name: string | null
  onChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog
      open={props.name !== null}
      onOpenChange={function (open) {
        if (!open) props.onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
        </AlertDialogHeader>
        <Input
          value={props.name ?? ''}
          className="h-8"
          placeholder="名称"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
          onKeyDown={function (event) {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onConfirm()
            }
          }}
        />
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
export { DeleteConfirmDialog, NameDialog }
