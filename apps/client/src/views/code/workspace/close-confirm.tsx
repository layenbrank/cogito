/**
 * 关闭未保存标签前的确认：全部关闭入口共用这一个弹窗。
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

function CloseConfirmDialog() {
  const pendingCloseIds = useCodeStore(function (state) {
    return state.pendingCloseIds
  })
  const tabs = useCodeStore(function (state) {
    return state.tabs
  })

  const titles = pendingCloseIds
    .map(function (id) {
      return tabs.find(function (tab) {
        return tab.id === id
      })?.title
    })
    .filter(function (title): title is string {
      return Boolean(title)
    })

  const description =
    titles.length === 1 ? `「${titles[0]}」有未保存更改，关闭后修改会丢失。` : `以下文件有未保存更改：${titles.join('、')}`

  return (
    <AlertDialog
      open={pendingCloseIds.length > 0}
      onOpenChange={function (open) {
        if (!open) cancelPendingClose()
      }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>关闭前确认</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={confirmPendingClose}>不保存并关闭</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { CloseConfirmDialog }
