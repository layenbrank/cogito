import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { useState } from 'react'

import type { GooseProviderEntry } from '@/features/agent/acp/goose-providers'
import {
  findModelLabel,
  findProviderBilling,
  findProviderLabel
} from '@/features/agent/model/display'
import {
  canThink,
  findModelKey,
  findModelPref,
  MODEL_PREF,
  readModelPrefs,
  THINKING_OPTIONS,
  writeModelPrefs,
  type ThinkingLevel
} from '@/features/agent/model/model-prefs'
import { parseModels } from '@/features/agent/model/providers'
import type { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/settings/settings.module.scss'
import type { ProbeStatus } from '../provider-card-header'

type StoreProviderRow = ReturnType<typeof useProviderStore.getState>['providers'][number]

function ProviderListSection(props: {
  loading: boolean
  configured: GooseProviderEntry[]
  storeProviders: StoreProviderRow[]
  probeStatus: Record<string, ProbeStatus>
  onModelChange: (providerId: string, model: string) => unknown
  onOpenUpdate: (entry: GooseProviderEntry) => void
}) {
  /** 思考强度草稿：写入 agent.json 的同时保留即时反馈（pref 本身不可订阅） */
  const [thinkingDraft, updateThinkingDraft] = useState<Record<string, ThinkingLevel>>(
    function () {
      const prefs = readModelPrefs()
      const next: Record<string, ThinkingLevel> = {}
      for (const key of Object.keys(prefs)) next[key] = prefs[key].thinking
      return next
    }
  )

  function writeThinking(providerID: string, model: string, level: ThinkingLevel) {
    const key = findModelKey(providerID, model)
    const prefs = readModelPrefs()
    writeModelPrefs({ ...prefs, [key]: { ...(prefs[key] ?? MODEL_PREF), thinking: level } })
    updateThinkingDraft(function (prev) {
      return { ...prev, [key]: level }
    })
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>个人模型</span>
        <span className={styles.sectionMeta}>
          {props.loading ? '加载中…' : `${props.configured.length} 个`}
        </span>
      </div>

      {props.loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5" />
        </div>
      ) : props.configured.length === 0 ? (
        <p
          className={`${styles.empty} text-muted-foreground`}
          title="点右上角「添加模型」选择服务商并填写密钥">
          暂无个人模型
        </p>
      ) : (
        <div className={styles.list}>
          {props.configured.map(function (entry) {
            const storeRow = props.storeProviders.find(function (provider) {
              return provider.id === entry.providerId || provider.kind === entry.providerId
            })
            const models = entry.models.length
              ? entry.models
              : parseModels(storeRow?.models ?? null)
            const modelLabel = storeRow?.model
              ? findModelLabel(storeRow.model)
              : entry.defaultModel
                ? findModelLabel(entry.defaultModel)
                : null
            const status = props.probeStatus[entry.providerId]
            const activeModel = storeRow?.model ?? entry.defaultModel ?? models[0] ?? null
            const thinkingKey = activeModel
              ? findModelKey(entry.providerId, activeModel)
              : ''
            const thinking =
              thinkingDraft[thinkingKey] ??
              (activeModel ? findModelPref(entry.providerId, activeModel).thinking : MODEL_PREF.thinking)

            return (
              <div
                key={entry.providerId}
                className={styles.row}>
                <div className={styles.rowIdentity}>
                  <span className={styles.cardBadge}>
                    <Icon
                      icon="lucide:server"
                      width={16}
                      height={16}
                    />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={styles.cardName}>
                        {modelLabel ?? findProviderLabel(entry.providerId, entry.providerName)}
                      </span>
                      {status === 'fail' ? (
                        <span className={styles.statusLabelFail}>校验失败</span>
                      ) : null}
                    </div>
                    <p className={styles.rowMeta}>
                      {findProviderLabel(entry.providerId, entry.providerName)}
                      {' · '}
                      {findProviderBilling(entry.providerId, entry.providerName)}
                    </p>
                  </div>
                </div>

                <div className={styles.rowActions}>
                  {activeModel && canThink(activeModel) ? (
                    <Select
                      items={THINKING_OPTIONS}
                      value={thinking}
                      onValueChange={function (level) {
                        if (level === null || !activeModel) return
                        writeThinking(entry.providerId, activeModel, level)
                      }}>
                      <SelectTrigger
                        size="sm"
                        aria-label="思考强度"
                        title="思考强度"
                        className={styles.modelSelect}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="center">
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
                  ) : null}
                  {models.length > 0 ? (
                    <Select
                      value={activeModel}
                      onValueChange={function (model) {
                        if (model === null) return
                        void props.onModelChange(entry.providerId, model)
                      }}>
                      <SelectTrigger
                        aria-label="默认模型"
                        className={styles.modelSelect}>
                        <SelectValue placeholder="默认模型" />
                      </SelectTrigger>
                      <SelectContent align="center">
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
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={styles.keyBtn}
                    onClick={function () {
                      props.onOpenUpdate(entry)
                    }}>
                    <Icon
                      icon="lucide:pencil"
                      className="size-3.5"
                    />
                    更新 API Key
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export { ProviderListSection }
