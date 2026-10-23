import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Spinner } from '@cogito/design/components/spinner'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import { findFieldLabel, findProviderLabel } from '@/features/agent/model/display'
import styles from '@/views/agent/settings/settings.module.scss'

interface ProviderCardFormProps {
  entry: GooseProviderEntry
  formValues: Record<string, string>
  saving: boolean
  /** 对话框自带页脚按钮时隐藏表单内提交 */
  hideSubmit?: boolean
  onFieldChange: (name: string, value: string) => void
  onSave: () => void
}

function ProviderCardForm(props: ProviderCardFormProps) {
  const { entry } = props
  const label = findProviderLabel(entry.providerId, entry.providerName)

  return (
    <div className={styles.addForm}>
      {props.hideSubmit ? null : (
        <p className={styles.fieldHint}>
          {entry.configured
            ? `为「${label}」更新密钥。旧密钥不会显示；校验失败时仍保留原配置。`
            : `填写「${label}」所需信息。密钥只保存在本机，不会上传。`}
        </p>
      )}
      {entry.configKeys.length === 0 ? (
        <p className={styles.fieldHint}>
          {entry.isAcp
            ? '此接入通过本机 CLI 使用，一般无需再填密钥，保存后即可检测是否就绪。'
            : '此接入无需额外字段，保存即可启用。'}
        </p>
      ) : (
        entry.configKeys.map(function (key) {
          const fieldLabel = findFieldLabel(key.name)
          return (
            <label
              key={key.name}
              className={styles.field}>
              <span className={styles.fieldLabel}>
                {fieldLabel}
                {key.required ? ' *' : ''}
              </span>
              <Input
                type={key.secret ? 'password' : 'text'}
                placeholder={
                  key.secret
                    ? entry.configured
                      ? '输入新的 API Key'
                      : '输入 API Key'
                    : (key.default ?? fieldLabel)
                }
                value={props.formValues[key.name] ?? ''}
                onChange={function (event) {
                  props.onFieldChange(key.name, event.target.value)
                }}
              />
            </label>
          )
        })
      )}
      {props.hideSubmit ? null : (
        <Button
          className={styles.addBtn}
          disabled={props.saving}
          onClick={props.onSave}>
          {props.saving ? <Spinner /> : null}
          {entry.configured ? '更新并保存' : '添加模型'}
        </Button>
      )}
    </div>
  )
}

export { ProviderCardForm }
