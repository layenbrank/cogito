/**
 * 设置 · 模型：当前模型卡（assistant-ui `settings-panel` 元素）。
 *
 * 四段都落在真实数据上，改完即生效（这张卡没有保存按钮）：
 * - 模型：当前接入里「显示状态」开着的模型，点一下切默认模型（`handleModelChange`）；
 * - 系统提示词：`agent.json` 的 `extraSystemPrompt`，追加在场景提示词之后；
 * - 温度：`agent.json` 的 `temperature`，同时 best-effort 写 goose `GOOSE_TEMPERATURE`；
 * - 开关：corex 工具（`corexMcpTools`，**新会话生效**）。
 */
import { AssistantLabelsProvider } from '@cogito/design/assistant/labels'
import { SettingsPanel, type SettingToggle } from '@cogito/design/assistant/settings-panel'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { findAcpHandle } from '@/features/agent/acp/connection'
import { fetchTemperature } from '@/features/agent/acp/goose-providers'
import { applyGooseTemperature, waitGooseReady } from '@/features/agent/acp/session'
import { findModelLabel } from '@/features/agent/model/display'
import { findModelPref, readModelPrefs } from '@/features/agent/model/model-prefs'
import { parseModels } from '@/features/agent/model/providers'
import { readTuning, writeTuning, type AgentTuning } from '@/features/agent/model/tuning'
import { useProviderStore } from '@/stores/provider'
import { ASSISTANT_LABELS_ZH } from '@/views/agent/chat/labels'

/** 分段控件放不下长列表：最多三段，当前模型一定在里面 */
const MODEL_SEGMENT_LIMIT = 3
/** 滑杆与文本框都是高频输入，攒一下再落盘 */
const WRITE_DELAY_MS = 400
const TOOL_TOGGLE_KEY = 'tools'

interface ModelTuningSectionProps {
  /** 切默认模型（设置页复用 `useModelInventory` 的同一条路径） */
  onModelChange: (providerID: string, model: string) => void | Promise<void>
}

interface ModelChoice {
  label: string
  model: string
}

function ModelTuningSection(props: ModelTuningSectionProps) {
  const providers = useProviderStore(function (state) {
    return state.providers
  })
  const activeProviderID = useProviderStore(function (state) {
    return state.activeProviderID
  })

  const [tuning, updateTuning] = useState<AgentTuning>(readTuning)
  const pendingRef = useRef<Partial<AgentTuning>>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeProvider =
    providers.find(function (provider) {
      return provider.id === activeProviderID
    }) ??
    providers.find(function (provider) {
      return provider.enabled
    })

  const choices = useMemo(
    function () {
      if (!activeProvider) return [] as ModelChoice[]
      const prefs = readModelPrefs()
      const visible = parseModels(activeProvider.models).filter(function (model) {
        return findModelPref(activeProvider.id, model, prefs).visible
      })
      const activeModel = activeProvider.model ?? visible[0] ?? ''
      const order: string[] = []
      if (activeModel) order.push(activeModel)
      for (const model of visible) {
        if (order.indexOf(model) < 0) order.push(model)
      }
      return order.slice(0, MODEL_SEGMENT_LIMIT).map(function (model) {
        return { label: findModelLabel(model, activeProvider), model }
      })
    },
    [activeProvider]
  )

  const activeModel = activeProvider?.model ?? choices[0]?.model ?? ''
  const activeLabel =
    choices.find(function (choice) {
      return choice.model === activeModel
    })?.label ?? activeModel

  /** 攒住的改动一起落盘；温度还要顺带同步给 goose */
  function flush() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const change = pendingRef.current
    pendingRef.current = {}
    if (Object.keys(change).length === 0) return
    writeTuning(change)
    if (typeof change.temperature === 'number') void applyGooseTemperature(change.temperature)
  }

  function queue(change: Partial<AgentTuning>) {
    pendingRef.current = { ...pendingRef.current, ...change }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, WRITE_DELAY_MS)
  }

  useEffect(function () {
    // 卸载时把还没来得及落盘的输入补上，别让最后几个字丢掉
    return function () {
      flush()
    }
  }, [])

  useEffect(function () {
    let cancelled = false
    void (async function () {
      try {
        await waitGooseReady()
        const handle = await findAcpHandle()
        const configured = await fetchTemperature(handle.connection)
        // goose 里配过就以它为准：这才是模型真正在用的值
        if (cancelled || configured === null) return
        updateTuning(function (prev) {
          return { ...prev, temperature: configured }
        })
      } catch (error) {
        console.warn('[agent-settings/model] 读取生成温度失败:', error)
      }
    })()
    return function () {
      cancelled = true
    }
  }, [])

  function handleModelChange(label: string) {
    if (!activeProvider) return
    const choice = choices.find(function (item) {
      return item.label === label
    })
    if (!choice || choice.model === activeModel) return
    void props.onModelChange(activeProvider.id, choice.model)
  }

  function handleSystemPrompt(value: string) {
    updateTuning(function (prev) {
      return { ...prev, extraSystemPrompt: value }
    })
    queue({ extraSystemPrompt: value })
  }

  function handleTemperature(value: number) {
    updateTuning(function (prev) {
      return { ...prev, temperature: value }
    })
    queue({ temperature: value })
  }

  function handleToggle(key: string) {
    if (key !== TOOL_TOGGLE_KEY) return
    const next = tuning.corexMcpTools === '1' ? '0' : '1'
    updateTuning(function (prev) {
      return { ...prev, corexMcpTools: next }
    })
    queue({ corexMcpTools: next })
    toast.info(next === '1' ? '已开启工具调用，新会话生效' : '已关闭工具调用，新会话生效')
  }

  const toggles: SettingToggle[] = [
    {
      key: TOOL_TOGGLE_KEY,
      label: '工具调用',
      detail: '让模型调用 corex 与 MCP 工具',
      on: tuning.corexMcpTools === '1'
    }
  ]

  return (
    <AssistantLabelsProvider labels={ASSISTANT_LABELS_ZH}>
      <SettingsPanel
        model={activeLabel}
        models={choices.map(function (choice) {
          return choice.label
        })}
        systemPrompt={tuning.extraSystemPrompt}
        temperature={tuning.temperature}
        toggles={toggles}
        onModelChange={handleModelChange}
        onSystemPromptChange={handleSystemPrompt}
        onTemperatureChange={handleTemperature}
        onToggle={handleToggle}
      />
    </AssistantLabelsProvider>
  )
}

export { ModelTuningSection }
export type { ModelTuningSectionProps }
