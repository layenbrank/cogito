/**
 * 模型接入子页（`/agent/settings`）：goose inventory 网格 + 动态 configKeys（对齐 Desktop）。
 */
import { Button } from '@i-thinking/design/components/button'
import { Spinner } from '@i-thinking/design/components/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { AgentTitlebar } from '@/views/agent/components/titlebar'
import { waitGooseReady } from '@/features/agent/acp/session'
import { useProviderStore } from '@/stores/provider'
import styles from '@/views/agent/settings/settings.module.scss'
import { ProviderCard, type ProbeStatus } from './provider-card'
import { upsertStoreProvider } from './provider-upsert'
import { ToolPermissionsSection } from './sections/tool-permissions'

function AgentSettings() {
  const navigate = useNavigate()
  const [loading, updateLoading] = useState(false)
  const [entries, updateEntries] = useState<GooseProviderEntry[]>([])
  const [activeId, updateActiveId] = useState<string | null>(null)
  const [formValues, updateFormValues] = useState<Record<string, string>>({})
  const [saving, updateSaving] = useState(false)
  const [probeStatus, updateProbeStatus] = useState<Record<string, ProbeStatus>>({})

  const active = entries.find(function (entry) {
    return entry.providerId === activeId
  })

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
      // 个别供应商落库失败不该让整页打不开：逐条记下，成功的照常显示
      for (const result of upserts) {
        if (result.status === 'rejected') {
          console.warn('[agent-settings] provider 落库失败:', result.reason)
        }
      }
    } catch (error) {
      console.error('[agent-settings] loadInventory failed:', error)
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
      console.warn('[agent-settings] 读取已有配置失败:', error)
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

  async function handleSave() {
    if (!active) return
    updateSaving(true)
    patchProbe(active.providerId, 'unknown')
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const fields = parseConfigFields(active.configKeys, formValues)

      for (const key of active.configKeys) {
        if (!key.required) continue
        if (key.secret && formValues[key.name]?.trim()) continue
        if (
          !fields.some(function (field) {
            return field.key === key.name
          })
        ) {
          if (active.configured && key.secret) continue
          toast.warning(`请填写 ${key.name}`)
          updateSaving(false)
          return
        }
      }

      let entry: GooseProviderEntry
      if (active.isAcp && fields.length === 0) {
        entry = await enableAcpProvider(handle.connection, active.providerId)
        const readiness = await checkAcpReadiness(handle.connection, active.providerId)
        if (!readiness.ready) {
          throw new Error(readiness.error || 'ACP 供应商未就绪')
        }
      } else {
        entry = await saveProviderConfig(handle.connection, active.providerId, fields)
        if (entry.isAcp) {
          const readiness = await checkAcpReadiness(handle.connection, active.providerId)
          if (!readiness.ready) {
            throw new Error(readiness.error || 'ACP 供应商未就绪')
          }
        }
      }

      await upsertStoreProvider(entry, formValues)
      const model = entry.defaultModel || entry.models[0] || null
      try {
        await saveDefaults(handle.connection, entry.providerId, model)
      } catch (error) {
        console.warn('[agent-settings] defaultsSave 跳过:', error)
      }

      useProviderStore.getState().toSetActiveProvider(entry.providerId)
      if (model) {
        await useProviderStore.getState().toUpdateProvider([{ id: entry.providerId, model }])
      }

      patchProbe(entry.providerId, 'ok')
      toast.success(`${entry.providerName} 已保存至 goose`)
      await loadInventory()
      updateActiveId(entry.providerId)
    } catch (error) {
      console.error('[agent-settings] handleSave failed:', error)
      patchProbe(active.providerId, 'fail')
      const detail = error instanceof Error ? error.message : '保存失败'
      toast.error(`${active.providerName}：${detail}`)
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
      console.warn('[agent-settings] 切换默认模型失败:', error)
    }
  }

  const storeProviders = useProviderStore(function (state) {
    return state.providers
  })

  return (
    <div className={styles.page}>
      <AgentTitlebar
        title="设置"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={function () {
              void navigate('/agent/chat')
            }}>
            返回对话
          </Button>
        }
      />
      <div className={styles.content}>
        <header className={styles.header}>
          <h1 className={styles.title}>设置</h1>
          <p className={styles.desc}>管理供应商、工具权限、扩展与诊断。</p>
        </header>
        <Tabs defaultValue="provider" className="flex-1">
          <TabsList variant="line" className="mb-3">
            <TabsTrigger value="provider">供应商</TabsTrigger>
            <TabsTrigger value="permissions">权限</TabsTrigger>
            <TabsTrigger value="extensions">扩展</TabsTrigger>
            <TabsTrigger value="usage">用量</TabsTrigger>
            <TabsTrigger value="diagnostics">诊断</TabsTrigger>
          </TabsList>

          <TabsContent value="provider">
            <div className={styles.body}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>供应商</span>
                  <span className={styles.sectionMeta}>
                    {loading ? '加载中…' : `${entries.length} 个`}
                  </span>
                </div>

                {loading ? (
                  <div className="flex justify-center py-6">
                    <Spinner className="size-5" />
                  </div>
                ) : entries.length === 0 ? (
                  <p className={`${styles.empty} text-muted-foreground`}>
                    goose inventory 为空，请确认 goose serve 已启动
                  </p>
                ) : (
                  <div className={styles.list}>
                    {entries.map(function (entry) {
                      const storeRow = storeProviders.find(function (provider) {
                        return provider.id === entry.providerId || provider.kind === entry.providerId
                      })
                      const isOpen = activeId === entry.providerId
                      return (
                        <ProviderCard
                          key={entry.providerId}
                          entry={entry}
                          storeRow={storeRow}
                          status={probeStatus[entry.providerId] ?? 'unknown'}
                          isOpen={isOpen}
                          formValues={formValues}
                          saving={saving}
                          onToggle={function () {
                            if (isOpen) {
                              updateActiveId(null)
                              return
                            }
                            void openEditor(entry)
                          }}
                          onModelChange={function (providerId, model) {
                            void handleModelChange(providerId, model)
                          }}
                          onFieldChange={patchField}
                          onSave={function () {
                            void handleSave()
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="permissions">
            <div className={styles.body}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>工具权限</span>
                  <span className={styles.sectionMeta}>总是允许 / 每次询问 / 从不允许</span>
                </div>
                <ToolPermissionsSection />
              </section>
            </div>
          </TabsContent>

          <TabsContent value="extensions">
            <div className={styles.body}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>扩展</span>
                </div>
                <p className={`${styles.empty} text-muted-foreground`}>MCP 扩展管理将在后续版本提供。</p>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="usage">
            <div className={styles.body}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>用量</span>
                </div>
                <p className={`${styles.empty} text-muted-foreground`}>用量统计将在后续版本提供。</p>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="diagnostics">
            <div className={styles.body}>
              <section className={styles.section}>
                <div className={styles.sectionHead}>
                  <span className={styles.sectionTitle}>诊断</span>
                </div>
                <p className={`${styles.empty} text-muted-foreground`}>诊断导出将在后续版本提供。</p>
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export default AgentSettings
