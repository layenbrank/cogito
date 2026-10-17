import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import { findModelLabel } from '@/features/agent/model/display'
import { parseModels } from '@/features/agent/model/providers'
import type { AgentProvider } from '@/stores/provider'
import styles from '@/views/agent/settings/settings.module.scss'

import { ProviderCardForm } from './provider-card-form.tsx'
import { ProviderCardHeader, type ProbeStatus } from './provider-card-header.tsx'

interface ProviderCardProps {
  entry: GooseProviderEntry
  storeRow: AgentProvider | undefined
  status: ProbeStatus
  isOpen: boolean
  formValues: Record<string, string>
  saving: boolean
  onToggle: () => void
  onModelChange: (providerId: string, model: string) => void
  onFieldChange: (name: string, value: string) => void
  onSave: () => void
  actionLabel?: string
}

function ProviderCard(props: ProviderCardProps) {
  const { entry, storeRow, status, isOpen } = props
  const models = entry.models.length ? entry.models : parseModels(storeRow?.models ?? null)

  return (
    <article className={styles.card}>
      <ProviderCardHeader
        entry={entry}
        status={status}
        isOpen={isOpen}
        actionLabel={props.actionLabel}
        onToggle={props.onToggle}
      />

      {entry.configured && models.length > 0 ? (
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>默认模型</span>
            <Select
              value={storeRow?.model ?? models[0] ?? null}
              onValueChange={function (model) {
                if (model === null) return
                props.onModelChange(entry.providerId, model)
              }}>
              <SelectTrigger
                aria-label="默认模型"
                className="w-full">
                <SelectValue placeholder="选择模型" />
              </SelectTrigger>
              <SelectContent>
                {models.map(function (model) {
                  return (
                    <SelectItem
                      key={model}
                      value={model}>
                      {findModelLabel(model)}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}

      {isOpen ? (
        <ProviderCardForm
          entry={entry}
          formValues={props.formValues}
          saving={props.saving}
          onFieldChange={props.onFieldChange}
          onSave={props.onSave}
        />
      ) : null}
    </article>
  )
}

export { ProviderCard }
export type { ProbeStatus, ProviderCardProps }
