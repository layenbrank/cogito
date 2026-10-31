import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogFooter
} from '@cogito/design/components/dialog'
import { cn } from 'cn'
import { toast } from 'sonner'

import { MediaLightbox } from '@/components/media-lightbox'
import { CardSheetDialogAside } from '@/views/signboard/card-sheet-dialog-aside.tsx'
import { CardSheetDialogAttach } from '@/views/signboard/card-sheet-dialog-attach.tsx'
import { CardSheetDialogHeader } from '@/views/signboard/card-sheet-dialog-header.tsx'
import { CardSheetDialogNotesChecks } from '@/views/signboard/card-sheet-dialog-notes-checks.tsx'
import styles from '@/views/signboard/signboard.module.scss'
import type { useCardSheet } from '@/views/signboard/use-card-sheet.ts'

type CardSheetDialogProps = ReturnType<typeof useCardSheet>

function CardSheetDialog(props: CardSheetDialogProps) {
  const {
    open,
    onUpdateOpen,
    handleAttachPaste,
    toUpdateEntry,
    entryID,
    lightboxMedias,
    isLightboxOpen,
    lightboxID,
    setIsLightboxOpen,
    setLightboxID
  } = props

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onUpdateOpen}>
        <DialogContent
          side="center"
          showCloseButton
          overlayClassName="bg-black/45 supports-backdrop-filter:backdrop-blur-[2px]"
          className={cn(
            styles.cardDialog,
            'h-[min(88vh,56rem)]! max-h-[min(88vh,56rem)]! w-[min(960px,94vw)]! max-w-[min(960px,94vw)]! sm:max-w-[min(960px,94vw)]!'
          )}
          onPaste={handleAttachPaste}>
          <CardSheetDialogHeader {...props} />

          <div className={styles.cardDialogBody}>
            <div className={styles.cardDialogMain}>
              <CardSheetDialogNotesChecks {...props} />
              <CardSheetDialogAttach {...props} />
            </div>
            <CardSheetDialogAside {...props} />
          </div>

          <DialogFooter className={styles.cardDialogFooter}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={function () {
                void toUpdateEntry(entryID, { archivedAt: Date.now() }).then(function (ok) {
                  if (!ok) {
                    toast.error('归档失败')
                    return
                  }
                  toast.success('已归档')
                  onUpdateOpen(false)
                })
              }}>
              <Icon
                icon="lucide:archive"
                className="size-4"
              />
              归档
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={function () {
                onUpdateOpen(false)
              }}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaLightbox
        open={isLightboxOpen}
        medias={lightboxMedias}
        initialId={lightboxID}
        onOpenChange={function (openNext) {
          setIsLightboxOpen(openNext)
          if (!openNext) setLightboxID(null)
        }}
      />
    </>
  )
}

export { CardSheetDialog }
