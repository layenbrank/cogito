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

import type { useSearchSurface } from '@/views/code/workspace/search/use-search-surface.ts'

type SearchSurfaceState = ReturnType<typeof useSearchSurface>

function SearchSurfaceReplaceDialog(props: SearchSurfaceState) {
  return (
    <AlertDialog
      open={props.isConfirmOpen}
      onOpenChange={props.setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>替换全部结果？</AlertDialogTitle>
          <AlertDialogDescription>
            将在 {props.groups.length} 个文件的 {props.totalMatches} 处内容中替换为「
            {props.replacement}」{props.isPreserveCase ? '（保留大小写）' : ''}，并直接写入磁盘。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={function () {
              void props.onConfirmReplace()
            }}>
            替换
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { SearchSurfaceReplaceDialog }
