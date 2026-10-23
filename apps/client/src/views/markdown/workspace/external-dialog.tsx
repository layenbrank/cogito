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

import { t } from '@/views/markdown/locale.ts'

interface ExternalDialogProps {
  open: boolean
  onReload: () => void
  onKeep: () => void
}

function ExternalDialog(props: ExternalDialogProps) {
  return (
    <AlertDialog open={props.open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('EXTERNAL_CHANGED_TITLE')}</AlertDialogTitle>
          <AlertDialogDescription>{t('EXTERNAL_CHANGED_DESC')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={props.onKeep}>{t('KEEP')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onReload}>{t('RELOAD')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { ExternalDialog }
