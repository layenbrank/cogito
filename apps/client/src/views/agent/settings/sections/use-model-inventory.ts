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
import { findProviderLabel } from '@/features/agent/model/display'
import { writeProviderSecret } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'
import { reportCaught } from '@/utils/exception-report'
import type { ProbeStatus } from '../provider-card-header'
import { upsertStoreProvider } from '../provider-upsert'
import type { EditorMode } from './model-editor-dialog'

function useModelInventory() {
  const [loading, updateLoading] = useState(false)
  const [entries, updateEntries] = useState<GooseProviderEntry[]>([])
  const [activeId, updateActiveId] = useState<string | null>(null)
  const [editorMode, updateEditorMode] = useState<EditorMode | null>(null)
  const [formValues, updateFormValues] = useState<Record<string, string>>({})
  const [saving, updateSaving] = useState(false)
  const [probeStatus, updateProbeStatus] = useState<Record<string, ProbeStatus>>({})
  const [pickedAddId, updatePickedAddId] = useState<string | null>(null)

  const storeProviders = useProviderStore(function (state) {
    return state.providers
  })

  const active = entries.find(function (entry) {
    return entry.providerId === activeId
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

  async function bootstrapInventory() {
    updateLoading(true)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const all = await fetchGooseProviders(handle.connection)
      const visible = findSettingsProviders(all).filter(function (entry) {
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
      const secretWrites = active.configKeys
        .filter(function (key) {
          return key.secret
        })
        .map(function (key) {
          const secret = formValues[key.name]?.trim() || null
          return writeProviderSecret(active.providerId, secret)
        })
      await Promise.allSettled(secretWrites)
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

  function handlePickedAddId(id: string) {
    updatePickedAddId(id)
    const entry = addable.find(function (item) {
      return item.providerId === id
    })
    if (entry) void openEditor(entry)
  }

  const platformProvider =
    storeProviders.find(function (provider) {
      return provider.id === COGITO_PROVIDER_ID || provider.kind === COGITO_PROVIDER_ID
    }) ?? null

  return {
    loading,
    configured,
    addable,
    storeProviders,
    probeStatus,
    platformProvider,
    editorMode,
    active,
    formValues,
    saving,
    pickedAddId,
    isDialogOpen: editorMode !== null,
    handleModelChange,
    handleOpenAdd,
    handleOpenUpdate,
    closeEditor,
    patchField,
    handleSave,
    handlePickedAddId
  }
}

export { useModelInventory }
