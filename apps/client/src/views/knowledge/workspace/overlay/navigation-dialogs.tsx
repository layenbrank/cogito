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

import { t } from '@/views/knowledge/locale.ts'
import type {
  DeleteTarget,
  NewTarget,
  RenameTarget
} from '@/views/knowledge/workspace/overlay/use-navigation-mutations.tsx'

function DeleteConfirmDialog(props: {
  target: DeleteTarget | null
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
            {target?.isDirectory ? t('DELETE_FOLDER_CONFIRM') : t('DELETE_CONFIRM')}
          </AlertDialogTitle>
          <AlertDialogDescription>{target?.absolute}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{t('DELETE')}</AlertDialogAction>
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
          placeholder={t('CREATE_NAME')}
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
          <AlertDialogCancel>{t('CONFIRM_CANCEL')}</AlertDialogCancel>
          <AlertDialogAction onClick={props.onConfirm}>{props.title}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DeleteConfirmDialog, NameDialog }
export type { NewTarget, RenameTarget }
