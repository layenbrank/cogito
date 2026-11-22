/**
 * 书签导入：宽 Dialog，承接大量文件夹勾选。
 */
import { Dialog, DialogContent } from '@cogito/design/components/dialog'

import { BookmarkImportWizard } from '@/views/bookmark/wizard'

interface BookmarkImportDialogProps {
  open: boolean
  onUpdateOpen: (open: boolean) => void
  onImported: (mirrorID: string) => void
}

function BookmarkImportDialog(props: BookmarkImportDialogProps) {
  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onUpdateOpen}>
      <DialogContent
        showCloseButton
        className={[
          // 大数据用宽框：约 48rem，高度跟视口走
          'flex max-h-[min(88vh,48rem)] w-full flex-col gap-0 overflow-hidden p-6 sm:max-w-3xl',
          '**:data-[slot=dialog-body]:flex **:data-[slot=dialog-body]:min-h-0 **:data-[slot=dialog-body]:flex-1',
          '**:data-[slot=dialog-body]:flex-col **:data-[slot=dialog-body]:gap-0',
          '**:data-[slot=dialog-body]:overflow-hidden **:data-[slot=dialog-body]:px-0 **:data-[slot=dialog-body]:pb-0'
        ].join(' ')}>
        {props.open ? (
          <BookmarkImportWizard
            onImported={function (mirrorID) {
              props.onImported(mirrorID)
              props.onUpdateOpen(false)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export { BookmarkImportDialog }
