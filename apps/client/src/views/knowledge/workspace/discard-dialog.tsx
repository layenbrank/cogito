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

import { t } from '@/views/knowledge/locale.ts'

interface DiscardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => void
  onDiscard: () => void
}

function DiscardDialog(props: DiscardDialogProps) {
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={props.onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('CONFIRM_DISCARD_TITLE')}</AlertDialogTitle>
          <AlertDialogDescription>{t('CONFIRM_DISCARD_DESC')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={props.onDiscard}>
            {t('CONFIRM_DISCARD')}
          </AlertDialogAction>
          <AlertDialogAction
            onClick={props.onSave}>
            {t('CONFIRM_SAVE')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DiscardDialog }
