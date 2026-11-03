/**
 * 关闭未保存标签 / 切换工作区前的确认：全部入口共用这一个弹窗。
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

import { useCodeStore } from '@/stores/code'
import { cancelPendingClose, confirmPendingClose } from '@/views/code/lib/close-tabs.ts'
import {
  cancelPendingRootsChange,
  confirmPendingRootsChange
} from '@/views/code/lib/workspace-switch.ts'

function findFolderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function CloseConfirmDialog() {
  const pendingCloseIds = useCodeStore(function (state) {
    return state.pendingCloseIds
  })
  const pendingRootsChange = useCodeStore(function (state) {
    return state.pendingRootsChange
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })

  const isRootsChange = pendingRootsChange !== null
  const titles = (isRootsChange ? pendingRootsChange.dirtyTabIDs : pendingCloseIds)
    .map(function (id) {
      return tabs.find(function (tab) {
        return tab.id === id
      })?.title
    })
    .filter(function (title): title is string {
      return Boolean(title)
    })

  const description = isRootsChange
    ? `切换到「${pendingRootsChange.roots.map(findFolderName).join('、')}」会关闭 ${titles.length} 个有未保存更改的文件：${titles.join('、')}。`
    : titles.length === 1
      ? `「${titles[0]}」有未保存更改，关闭后修改会丢失。`
      : `以下文件有未保存更改：${titles.join('、')}`

  function onConfirm() {
    if (isRootsChange) {
      confirmPendingRootsChange()
      return
    }
    confirmPendingClose()
  }

  function onCancel() {
    if (isRootsChange) {
      cancelPendingRootsChange()
      return
    }
    cancelPendingClose()
  }

  return (
    <AlertDialog
      open={isRootsChange || pendingCloseIds.length > 0}
      onOpenChange={function (open) {
        if (!open) onCancel()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isRootsChange ? '切换工作区前确认' : '关闭前确认'}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {isRootsChange ? '不保存并切换' : '不保存并关闭'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { CloseConfirmDialog }
