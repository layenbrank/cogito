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
import { THINKING_OPTIONS, type ThinkingLevel } from '@/features/agent/model/model-prefs'
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
  /** 思考强度：按该接入的当前模型存一份（新接入也能在保存时定下来） */
  thinking: ThinkingLevel
  onThinkingChange: (level: ThinkingLevel) => void
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
                items={props.addable.map(function (entry) {
                  return {
                    value: entry.providerId,
                    label: findProviderLabel(entry.providerId, entry.providerName)
                  }
                })}
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

          {props.active ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>思考强度</span>
              <Select
                items={THINKING_OPTIONS}
                value={props.thinking}
                onValueChange={function (value) {
                  if (value === null) return
                  props.onThinkingChange(value)
                }}>
                <SelectTrigger aria-label="思考强度">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom">
                  {THINKING_OPTIONS.map(function (option) {
                    return (
                      <SelectItem
                        key={option.value}
                        value={option.value}>
                        {option.label}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <span className={styles.fieldHint}>按模型保存，之后可在「模型设置」里逐个调</span>
            </label>
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
