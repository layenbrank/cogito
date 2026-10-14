/**
 * 设置 · 模型：对齐 Qoder — 扁平行列表 +「更新 API Key」对话框。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@i-thinking/design/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@i-thinking/design/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Spinner } from '@i-thinking/design/components/spinner'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  checkAcpReadiness,
  enableAcpProvider,
  fetchGooseProviders,
  fetchProviderConfig,
  findSettingsProviders,
  parseConfigFields,
  saveDefaults,
  saveProviderConfig,
  type GooseProviderEntry
} from '@/features/agent/acp/goose-providers'
import { waitGooseReady } from '@/features/agent/acp/session'
import {
  findModelLabel,
  findProviderBilling,
  findProviderLabel
} from '@/features/agent/model/display'
import { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/settings/settings.module.scss'
import type { ProbeStatus } from '../provider-card-header'
import { ProviderCardForm } from '../provider-card-form'
import { upsertStoreProvider } from '../provider-upsert'

type EditorMode = 'add' | 'update' | null

function ModelSection() {
  const [loading, updateLoading] = useState(false)
  const [entries, updateEntries] = useState<GooseProviderEntry[]>([])
  const [activeId, updateActiveId] = useState<string | null>(null)
  const [editorMode, updateEditorMode] = useState<EditorMode>(null)
  const [formValues, updateFormValues] = useState<Record<string, string>>({})
  const [saving, updateSaving] = useState(false)
  const [probeStatus, updateProbeStatus] = useState<Record<string, ProbeStatus>>({})
  const [pickedAddId, updatePickedAddId] = useState<string | null>(null)

  const active = entries.find(function (entry) {
    return entry.providerId === activeId
  })

  const storeProviders = useProviderStore(function (state) {
    return state.providers
  })

  const configured = useMemo(
    function () {
      return entries.filter(function (entry) {
        return entry.configured
      })
    },
    [entries]
  )

  const addable = useMemo(
    function () {
      return entries.filter(function (entry) {
        return !entry.configured
      })
    },
    [entries]
  )

  const isDialogOpen = editorMode !== null

  async function loadInventory() {
    updateLoading(true)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const all = await fetchGooseProviders(handle.connection)
      const visible = findSettingsProviders(all)
      updateEntries(visible)

      const store = useProviderStore.getState()
      await store.toReadProviders()
      const upserts = await Promise.allSettled(
        visible
          .filter(function (entry) {
            return entry.configured
          })
          .map(function (entry) {
            return upsertStoreProvider(entry, {})
          })
      )
      for (const result of upserts) {
        if (result.status === 'rejected') {
          console.warn('[agent-settings/model] provider 落库失败:', result.reason)
        }
      }
    } catch (error) {
      console.error('[agent-settings/model] loadInventory failed:', error)
      const detail = error instanceof Error ? error.message : '加载失败'
      toast.error(detail)
    } finally {
      updateLoading(false)
    }
  }

  useEffect(
    function () {
      void loadInventory()
    },
    []
  )

  async function openEditor(entry: GooseProviderEntry) {
    updateActiveId(entry.providerId)
    const initial: Record<string, string> = {}
    for (const key of entry.configKeys) {
      initial[key.name] = key.default?.trim() || ''
    }

    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const fields = await fetchProviderConfig(handle.connection, entry.providerId)
      for (const field of fields) {
        if (field.value) initial[field.key] = field.value
      }
    } catch (error) {
      console.warn('[agent-settings/model] 读取已有配置失败:', error)
    }

    updateFormValues(initial)
  }

  function patchField(name: string, value: string) {
    updateFormValues(function (prev) {
      return { ...prev, [name]: value }
    })
  }

  function patchProbe(providerId: string, status: ProbeStatus) {
    updateProbeStatus(function (prev) {
      return { ...prev, [providerId]: status }
    })
  }

  function closeEditor() {
    updateEditorMode(null)
    updateActiveId(null)
    updatePickedAddId(null)
  }

  async function handleSave() {
    if (!active) return
    updateSaving(true)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const fields = parseConfigFields(active.configKeys, formValues)
      await saveProviderConfig(handle.connection, active.providerId, fields)
      if (active.isAcp) {
        await enableAcpProvider(handle.connection, active.providerId)
        const readiness = await checkAcpReadiness(handle.connection, active.providerId)
        patchProbe(active.providerId, readiness.ready ? 'ok' : 'fail')
      } else {
        patchProbe(active.providerId, 'ok')
      }
      await upsertStoreProvider(active, formValues)
      toast.success(
        editorMode === 'add'
          ? `${findProviderLabel(active.providerId, active.providerName)} 已添加`
          : `${findProviderLabel(active.providerId, active.providerName)} 密钥已更新`
      )
      closeEditor()
      await loadInventory()
    } catch (error) {
      console.error('[agent-settings/model] save failed:', error)
      const detail = error instanceof Error ? error.message : '保存失败'
      toast.error(`${findProviderLabel(active.providerId, active.providerName)}：${detail}`)
      patchProbe(active.providerId, 'fail')
    } finally {
      updateSaving(false)
    }
  }

  async function handleModelChange(providerId: string, model: string) {
    await useProviderStore.getState().toUpdateProvider([{ id: providerId, model }])
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      await saveDefaults(handle.connection, providerId, model)
    } catch (error) {
      console.warn('[agent-settings/model] 切换默认模型失败:', error)
    }
  }

  function handleOpenAdd() {
    if (addable.length === 0) {
      toast.info('当前可添加的接入都已配置，或请先启动 goose')
      return
    }
    const first = addable[0]
    updatePickedAddId(first.providerId)
    updateEditorMode('add')
    void openEditor(first)
  }

  function handleOpenUpdate(entry: GooseProviderEntry) {
    updateEditorMode('update')
    void openEditor(entry)
  }

  const dialogTitle = editorMode === 'add' ? '添加模型' : '更新 API Key'
  const dialogDesc =
    editorMode === 'add'
      ? '选择服务商并填写密钥。调用费用由对应服务商结算；密钥只保存在本机。'
      : active
        ? `为「${findProviderLabel(active.providerId, active.providerName)}」输入新的 API Key。旧密钥不会显示，校验失败时仍会保留。`
        : '输入新的 API Key。旧密钥不会显示，校验失败时仍会保留。'

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className={styles.title}>模型</h2>
          <p className={styles.desc}>
            使用自己的 API Key 添加并管理个人模型；密钥只保存在本机。
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={handleOpenAdd}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
          添加模型
        </Button>
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <span className={styles.sectionTitle}>个人模型</span>
          <span className={styles.sectionMeta}>
            {loading ? '加载中…' : `${configured.length} 个`}
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-5" />
          </div>
        ) : configured.length === 0 ? (
          <p className={`${styles.empty} text-muted-foreground`}>
            还没有个人模型。点右上角「添加模型」选择服务商并填写密钥。
          </p>
        ) : (
          <div className={styles.list}>
            {configured.map(function (entry) {
              const storeRow = storeProviders.find(function (provider) {
                return provider.id === entry.providerId || provider.kind === entry.providerId
              })
              const models = entry.models.length
                ? entry.models
                : parseModelsSafe(storeRow?.models ?? null)
              const modelLabel = storeRow?.model
                ? findModelLabel(storeRow.model)
                : entry.defaultModel
                  ? findModelLabel(entry.defaultModel)
                  : null
              const status = probeStatus[entry.providerId]

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
                    {models.length > 0 ? (
                      <Select
                        value={
                          storeRow?.model ?? entry.defaultModel ?? models[0] ?? null
                        }
                        onValueChange={function (model) {
                          if (model === null) return
                          void handleModelChange(entry.providerId, model)
                        }}>
                        <SelectTrigger
                          aria-label="默认模型"
                          className={styles.modelSelect}>
                          <SelectValue placeholder="默认模型" />
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
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={styles.keyBtn}
                      onClick={function () {
                        handleOpenUpdate(entry)
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

      <Dialog
        open={isDialogOpen}
        onOpenChange={function (open) {
          if (!open) closeEditor()
        }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDesc}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            {editorMode === 'add' ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>服务商</span>
                <Select
                  value={pickedAddId}
                  onValueChange={function (id) {
                    if (!id) return
                    updatePickedAddId(id)
                    const entry = addable.find(function (item) {
                      return item.providerId === id
                    })
                    if (entry) void openEditor(entry)
                  }}>
                  <SelectTrigger aria-label="服务商">
                    <SelectValue placeholder="选择服务商" />
                  </SelectTrigger>
                  <SelectContent>
                    {addable.map(function (entry) {
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

            {active ? (
              <ProviderCardForm
                entry={active}
                formValues={formValues}
                saving={saving}
                hideSubmit
                onFieldChange={patchField}
                onSave={function () {
                  void handleSave()
                }}
              />
            ) : null}

            {editorMode === 'update' ? (
              <p className={styles.fieldHint}>
                保存前会校验此密钥；密钥只保存在本机安全存储中。
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeEditor}>
              取消
            </Button>
            <Button
              type="button"
              disabled={saving || !active}
              onClick={function () {
                void handleSave()
              }}>
              {saving ? <Spinner className="size-3.5" /> : null}
              {editorMode === 'add' ? '添加模型' : '更新 API Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function parseModelsSafe(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(function (value): value is string {
          return typeof value === 'string'
        })
      : []
  } catch {
    return []
  }
}

export { ModelSection }
