import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Spinner } from '@cogito/design/components/spinner'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import { findFieldLabel } from '@/features/agent/model/display'
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

  return (
    <div className={styles.addForm}>
      {props.hideSubmit || entry.configKeys.length > 0 ? null : (
        <p
          className={styles.fieldHint}
          title={
            entry.isAcp
              ? '此接入通过本机 CLI 使用，一般无需再填密钥'
              : '此接入无需额外字段，保存即可启用'
          }>
          {entry.isAcp ? '本机 CLI，一般无需密钥' : '无需额外字段'}
        </p>
      )}
      {entry.configKeys.length === 0 ? null : (
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
