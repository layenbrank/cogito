import { Button } from '@cogito/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import { findProviderLabel } from '@/features/agent/model/display'
import styles from '@/views/agent/settings/settings.module.scss'
import { ProviderCardForm } from '../provider-card-form'

type EditorMode = 'add' | 'update'

function ModelEditorDialog(props: {
  open: boolean
  mode: EditorMode
  active: GooseProviderEntry | undefined
  addable: GooseProviderEntry[]
  pickedAddId: string | null
  formValues: Record<string, string>
  saving: boolean
  onClose: () => void
  onPickedAddId: (id: string) => void
  onFieldChange: (name: string, value: string) => void
  onSave: () => void
}) {
  const dialogTitle = props.mode === 'add' ? '添加模型' : '更新 API Key'
  const dialogDesc =
    props.mode === 'add'
      ? '选择服务商并填写密钥。调用费用由对应服务商结算；密钥只保存在本机。'
      : props.active
        ? `为「${findProviderLabel(props.active.providerId, props.active.providerName)}」输入新的 API Key。旧密钥不会显示，校验失败时仍会保留。`
        : '输入新的 API Key。旧密钥不会显示，校验失败时仍会保留。'

  return (
    <Dialog
      open={props.open}
      onOpenChange={function (open) {
        if (!open) props.onClose()
      }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {props.mode === 'add' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>服务商</span>
              <Select
                value={props.pickedAddId}
                onValueChange={function (id) {
                  if (!id) return
                  props.onPickedAddId(id)
                }}>
                <SelectTrigger aria-label="服务商">
                  <SelectValue placeholder="选择服务商" />
                </SelectTrigger>
                <SelectContent side="bottom">
                  {props.addable.map(function (entry) {
                    return (
                      <SelectItem
                        key={entry.providerId}
                        value={entry.providerId}>
                        {findProviderLabel(entry.providerId, entry.providerName)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </label>
          ) : null}

          {props.active ? (
            <ProviderCardForm
              entry={props.active}
              formValues={props.formValues}
              saving={props.saving}
              hideSubmit
              onFieldChange={props.onFieldChange}
              onSave={props.onSave}
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={props.onClose}>
            取消
          </Button>
          <Button
            type="button"
            disabled={props.saving || !props.active}
            onClick={props.onSave}>
            {props.saving ? <Spinner className="size-3.5" /> : null}
            {props.mode === 'add' ? '添加模型' : '更新 API Key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ModelEditorDialog }
export type { EditorMode }
