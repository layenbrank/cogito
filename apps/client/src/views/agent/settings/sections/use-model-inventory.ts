import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import { COGITO_PROVIDER_ID, syncCogitoGatewayCatalog } from '@/features/agent/acp/cogito-provider'
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
import { waitGooseReady } from '@/features/agent/port/session'
import { findProviderLabel } from '@/features/agent/model/display'
import {
  findModelKey,
  findModelPref,
  MODEL_PREF,
  readModelPrefs,
  writeModelPrefs,
  type ThinkingLevel
} from '@/features/agent/model/model-prefs'
import { writeProviderSecret } from '@/features/persist'
import { useProviderStore } from '@/stores/provider'
import { reportCaught } from '@/utils/exception-report'
import type { ProbeStatus } from '../provider-card-header'
import { upsertStoreProvider } from '../provider-upsert'
import type { EditorMode } from './model-editor-dialog'

/**
 * 弹窗里这个接入将要用的模型：配置字段里带了模型名就认它，否则用本地行的默认模型。
 *
 * 思考强度是「每个模型一份」的偏好，所以保存时必须知道是哪个模型。
 */
function findEntryModel(entry: GooseProviderEntry, formValues: Record<string, string>): string {
  for (const [key, value] of Object.entries(formValues)) {
    if (/MODEL/i.test(key) && value.trim()) return value.trim()
  }
  const row = useProviderStore.getState().providers.find(function (provider) {
    return provider.id === entry.providerId || provider.kind === entry.providerId
  })
  return row?.model?.trim() || entry.defaultModel || entry.models[0] || ''
}

function useModelInventory() {
  /** 读取配置的请求序号：连着切两个接入时，先发后到的那份不能覆盖当前表单 */
  const editorSeqRef = useRef(0)
  const [loading, updateLoading] = useState(false)
  const [entries, updateEntries] = useState<GooseProviderEntry[]>([])
  const [activeId, updateActiveId] = useState<string | null>(null)
  const [editorMode, updateEditorMode] = useState<EditorMode | null>(null)
  const [formValues, updateFormValues] = useState<Record<string, string>>({})
  const [saving, updateSaving] = useState(false)
  /** 正在读这个接入的已有配置：读完之前不允许保存（见 `openEditor`） */
  const [loadingConfig, updateLoadingConfig] = useState(false)
  const [probeStatus, updateProbeStatus] = useState<Record<string, ProbeStatus>>({})
  const [pickedAddId, updatePickedAddId] = useState<string | null>(null)
  /** 弹窗里的思考强度草稿（保存时写进该模型的偏好） */
  const [editorThinking, updateEditorThinking] = useState<ThinkingLevel>(MODEL_PREF.thinking)

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
    /*
     * 闸门：`activeId` 先切、配置后到，中间那几帧表单里还是上一个接入的值。
     * 不拦住的话，「切换接入 → 立刻点保存」会把上一个接入的字段写进当前接入。
     */
    updateLoadingConfig(true)
    const seq = ++editorSeqRef.current
    const initial: Record<string, string> = {}
    for (const key of entry.configKeys) {
      initial[key.name] = key.default?.trim() || ''
    }

    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const fields = await fetchProviderConfig(handle.connection, entry.providerId)
      // 中间又切了别的接入：这份结果已经不属于当前表单，整份丢掉
      if (seq !== editorSeqRef.current) return
      for (const field of fields) {
        if (field.value) initial[field.key] = field.value
      }
    } catch (error) {
      console.warn('[agent-settings/model] 读取已有配置失败:', error)
    } finally {
      // 只关自己那次闸门，别把后来者的 loading 清掉
      if (seq === editorSeqRef.current) updateLoadingConfig(false)
    }

    updateFormValues(initial)
    const model = findEntryModel(entry, initial)
    updateEditorThinking(
      model ? findModelPref(entry.providerId, model).thinking : MODEL_PREF.thinking
    )
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
    // 配置还没读完就保存 = 拿上一个接入的字段值覆盖当前接入
    if (loadingConfig) {
      toast.info('配置还在读取，稍等一下再保存')
      return
    }
    updateSaving(true)
    try {
      await waitGooseReady()
      const handle = await findAcpHandle()
      const fields = parseConfigFields(active.configKeys, formValues)
      await saveProviderConfig(handle.connection, active.providerId, fields)
      /*
       * 空密钥 = 用户没改（`parseConfigFields` 也是跳过空值），
       * **不能**当成「删掉这个接入的密钥」：以前空值直接写 null，
       * 于是「只是想改个模型、密钥框本来就回填不出来」一保存就把钥匙串清了。
       * 真要清除得走单独动作。
       */
      const secretWrites = active.configKeys
        .filter(function (key) {
          return key.secret
        })
        .map(function (key) {
          const secret = formValues[key.name]?.trim() ?? ''
          if (!secret) return null
          return writeProviderSecret(active.providerId, secret)
        })
        .filter(function (job) {
          return job !== null
        })
      await Promise.allSettled(secretWrites)
      if (active.isAcp) {
        await enableAcpProvider(handle.connection, active.providerId)
        const readiness = await checkAcpReadiness(handle.connection, active.providerId)
        patchProbe(active.providerId, readiness.ready ? 'ok' : 'fail')
      } else {
        patchProbe(active.providerId, 'ok')
      }
      await upsertStoreProvider(active, formValues, { enable: true })
      // 思考强度按模型存：弹窗里选的那一档写进该接入当前模型的偏好
      const model = findEntryModel(active, formValues)
      if (model) {
        const key = findModelKey(active.providerId, model)
        const prefs = readModelPrefs()
        void writeModelPrefs({
          ...prefs,
          [key]: { ...(prefs[key] ?? MODEL_PREF), thinking: editorThinking }
        })
      }
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
    loadingConfig,
    pickedAddId,
    editorThinking,
    isDialogOpen: editorMode !== null,
    handleModelChange,
    handleOpenAdd,
    handleOpenUpdate,
    closeEditor,
    patchField,
    patchThinking: updateEditorThinking,
    handleSave,
    handlePickedAddId
  }
}

export { useModelInventory }
