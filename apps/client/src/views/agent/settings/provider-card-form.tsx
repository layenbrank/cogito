import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Spinner } from '@i-thinking/design/components/spinner'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import styles from '@/views/agent/settings/settings.module.scss'

interface ProviderCardFormProps {
  entry: GooseProviderEntry
  formValues: Record<string, string>
  saving: boolean
  onFieldChange: (name: string, value: string) => void
  onSave: () => void
}

function ProviderCardForm(props: ProviderCardFormProps) {
  const { entry } = props
  return (
    <div className={styles.addForm}>
      {entry.setupSteps.length > 0 ? (
        <p className={styles.fieldHint}>{entry.setupSteps.join(' · ')}</p>
      ) : null}
      {entry.configKeys.length === 0 ? (
        <p className={styles.fieldHint}>
          {entry.isAcp
            ? '此 ACP 供应商无需额外字段，保存将启用并探测就绪。'
            : '此供应商无需配置字段。'}
        </p>
      ) : (
        entry.configKeys.map(function (key) {
          return (
            <label
              key={key.name}
              className={styles.field}>
              <span className={styles.fieldLabel}>
                {key.name}
                {key.required ? ' *' : ''}
              </span>
              <Input
                type={key.secret ? 'password' : 'text'}
                placeholder={
                  key.secret
                    ? entry.configured
                      ? '已配置（输入可覆盖）'
                      : '密钥'
                    : (key.default ?? key.name)
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
      <Button
        className={styles.addBtn}
        disabled={props.saving}
        onClick={props.onSave}>
        {props.saving ? <Spinner /> : null}
        保存到 goose
      </Button>
    </div>
  )
}

export { ProviderCardForm }
