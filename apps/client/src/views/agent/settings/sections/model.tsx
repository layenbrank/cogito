/**
 * 设置 · 模型：对齐 Qoder — 扁平行列表 +「更新 API Key」对话框。
 */
import { Icon } from '@iconify/react/offline'
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
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import {
  COGITO_PROVIDER_ID,
  syncCogitoGatewayCatalog
} from '@/features/agent/acp/cogito-provider'
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
import { parseModels } from '@/features/agent/model/providers'
import { writeProviderSecret } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'
import { reportCaught } from '@/utils/exception-report'
import styles from '@/views/agent/settings/settings.module.scss'
import type { ProbeStatus } from '../provider-card-header'
import { ProviderCardForm } from '../provider-card-form'
import { upsertStoreProvider } from '../provider-upsert'

type EditorMode = 'add' | 'update' | null

/** 顶部标题与「添加模型」入口 */
function ModelHeader(props: { onAdd: () => void }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={styles.title}>模型</h2>
        <p className={styles.desc}>
          组织模型由管理员在后台配置；个人模型用自己的 API Key 添加，密钥只保存在本机。
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 gap-1.5"
        onClick={props.onAdd}>
        <Icon
          icon="lucide:plus"
          className="size-3.5"
        />
        添加模型
      </Button>
    </header>
  )
}

type StoreProviderRow = ReturnType<typeof useProviderStore.getState>['providers'][number]

/** 组织模型：只读展示网关目录镜像（不可改密钥） */
function PlatformModelsSection(props: {
  loading: boolean
  provider: StoreProviderRow | null
  onModelChange: (providerId: string, model: string) => unknown
}) {
  const models = props.provider ? parseModels(props.provider.models) : []

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>组织模型</span>
        <span className={styles.sectionMeta}>
          {props.loading ? '加载中…' : `${models.length} 个`}
        </span>
      </div>

      {props.loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-5" />
        </div>
      ) : !props.provider || models.length === 0 ? (
        <p
          className={`${styles.empty} text-muted-foreground`}
          title="请确认已登录，且管理员已在后台启用模型">
          暂无组织模型
        </p>
      ) : (
        <div className={styles.list}>
          <div className={styles.row}>
            <div className={styles.rowIdentity}>
              <span className={styles.cardBadge}>
                <Icon
                  icon="lucide:building-2"
                  width={16}
                  height={16}
                />
              </span>
              <div className="min-w-0">
                <span className={styles.cardName}>
                  {findProviderLabel(props.provider.kind, props.provider.name)}
                </span>
                <p className={styles.rowMeta}>
                  {findProviderBilling(props.provider.kind, props.provider.name)}
                  {' · '}
                  {models.length} 个可用
                </p>
              </div>
            </div>
            <div className={styles.rowActions}>
              <Select
                value={props.provider.model ?? models[0] ?? null}
                onValueChange={function (model) {
                  if (model === null) return
                  void props.onModelChange(props.provider!.id, model)
                }}>
                <SelectTrigger
                  aria-label="默认组织模型"
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
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** 已配置的个人模型：扁平行 + 默认模型选择 + 更新密钥 */
function ProviderListSection(props: {
  loading: boolean
  configured: GooseProviderEntry[]
  storeProviders: StoreProviderRow[]
  probeStatus: Record<string, ProbeStatus>
  onModelChange: (providerId: string, model: string) => unknown
  onOpenUpdate: (entry: GooseProviderEntry) => void
}) {
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
                      value={storeRow?.model ?? entry.defaultModel ?? models[0] ?? null}
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

  async function bootstrapInventory() {
    updateLoading(true)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const all = await fetchGooseProviders(handle.connection)
      const visible = findSettingsProviders(all).filter(function (entry) {
        // 组织模型由网关目录镜像，不走 BYOK 表单
        return entry.providerId !== COGITO_PROVIDER_ID
      })
      updateEntries(visible)

      const store = useProviderStore.getState()
      await store.toReadProviders()
      try {
        await syncCogitoGatewayCatalog()
      } catch (error) {
        console.warn('[agent-settings/model] 同步组织模型失败:', error)
      }
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
      reportCaught('agent-settings.model.bootstrapInventory', error)
      const detail = error instanceof Error ? error.message : '加载失败'
      toast.error(detail)
    } finally {
      updateLoading(false)
    }
  }

  useEffect(function () {
    // 放进微任务：bootstrapInventory 首行就是 updateLoading(true)，直接在 effect 体里调会级联渲染
    let cancelled = false
    void Promise.resolve().then(function () {
      if (cancelled) return
      return bootstrapInventory()
    })
    return function () {
      cancelled = true
    }
  }, [])

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
      // 密钥双写 OS Keyring（goose 仍持自己的配置；SQLite 只存非密元数据）
      for (const key of active.configKeys) {
        if (!key.secret) continue
        const secret = formValues[key.name]?.trim() || null
        await writeProviderSecret(active.providerId, secret)
      }
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
      await bootstrapInventory()
    } catch (error) {
      reportCaught('agent-settings.model.save', error)
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

  const platformProvider =
    storeProviders.find(function (provider) {
      return provider.id === COGITO_PROVIDER_ID || provider.kind === COGITO_PROVIDER_ID
    }) ?? null

  return (
    <div className="flex flex-col gap-5">
      <ModelHeader onAdd={handleOpenAdd} />

      <PlatformModelsSection
        loading={loading}
        provider={platformProvider}
        onModelChange={handleModelChange}
      />

      <ProviderListSection
        loading={loading}
        configured={configured}
        storeProviders={storeProviders}
        probeStatus={probeStatus}
        onModelChange={handleModelChange}
        onOpenUpdate={handleOpenUpdate}
      />

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
                  <SelectContent side="bottom">
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

export { ModelSection }
