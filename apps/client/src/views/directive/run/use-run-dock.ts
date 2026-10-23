import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorexStore } from '@/stores/corex.ts'
import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'
import { useTerminalStore } from '@/stores/terminal.ts'
import { capsFromTriggers } from './run-caps'
import { buildInputPayload, parseJsonObject, seedInputValues } from './run-input.ts'

/**
 * 底部 Dock「运行 / 试跑 / 历史」共用状态。
 * `directiveName` 为空时（指令列表页）只提供运行态只读信息。
 */
function useRunDock(directiveName: string | null) {
  const runs = useCorexStore(function (state) {
    return state.runs
  })
  const focusRunId = useCorexStore(function (state) {
    return state.focusRunId
  })
  const runHistory = useCorexStore(function (state) {
    return state.runHistory
  })
  const startRun = useCorexStore(function (state) {
    return state.startRun
  })
  const startTrial = useCorexStore(function (state) {
    return state.startTrial
  })
  const cancelRun = useCorexStore(function (state) {
    return state.cancelRun
  })
  const fetchRunHistory = useCorexStore(function (state) {
    return state.fetchRunHistory
  })
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const draft = useCorexStore(function (state) {
    return state.draft
  })
  const editorName = useCorexStore(function (state) {
    return state.editorName
  })
  const saveDraft = useCorexStore(function (state) {
    return state.saveDraft
  })
  const isDraftDirty = useCorexStore(function (state) {
    return state.isDraftDirty
  })
  const directives = useCorexStore(function (state) {
    return state.directives
  })

  const declaredInputs = useMemo(
    function () {
      if (!directiveName) return [] as DirectiveInput[]
      if (draft && editorName === directiveName) return draft.inputs ?? []
      return [] as DirectiveInput[]
    },
    [draft, editorName, directiveName]
  )

  const inputSignature = useMemo(
    function () {
      return declaredInputs
        .map(function (input) {
          return `${input.name}:${input.required ? '1' : '0'}:${JSON.stringify(input.default ?? null)}`
        })
        .join('|')
    },
    [declaredInputs]
  )

  const hasInputsOnMount = declaredInputs.length > 0
  const [formKey, setFormKey] = useState(function () {
    return `${directiveName ?? ''}:${inputSignature}`
  })
  const [paramsJson, setParamsJson] = useState('{}')
  const [inputValues, setInputValues] = useState<Record<string, string>>(function () {
    return hasInputsOnMount ? seedInputValues(declaredInputs) : {}
  })
  const [showAdvancedJson, setShowAdvancedJson] = useState(!hasInputsOnMount)
  const [trialActionPick, setTrialActionPick] = useState<string | null>(null)
  const trialAction = trialActionPick ?? catalog[0]?.id ?? ''
  const [trialParamsJson, setTrialParamsJson] = useState('{}')

  // 输入声明变化时重置表单（与原先 RunPanel key 行为一致；render 期同步避免 effect 级联）
  const nextFormKey = `${directiveName ?? ''}:${inputSignature}`
  if (formKey !== nextFormKey) {
    setFormKey(nextFormKey)
    setInputValues(seedInputValues(declaredInputs))
    setShowAdvancedJson(declaredInputs.length === 0)
    setParamsJson('{}')
  }

  const hasDeclaredInputs = declaredInputs.length > 0

  const caps = useMemo(
    function () {
      return capsFromTriggers(draft?.triggers)
    },
    [draft?.triggers]
  )

  const stepCount = useMemo(
    function () {
      if (!directiveName) return 0
      if (draft && editorName === directiveName) {
        return Array.isArray(draft.steps) ? draft.steps.length : 0
      }
      const entry = directives.find(function (item) {
        return item.name === directiveName
      })
      return entry?.summary?.step_count ?? 0
    },
    [draft, editorName, directiveName, directives]
  )

  const activeRun = useMemo(
    function () {
      const byFocus = runs.find(function (run) {
        return run.id === focusRunId
      })
      if (byFocus) return byFocus
      if (!directiveName) return undefined
      return runs.find(function (run) {
        return run.name === directiveName && run.status === 'running'
      })
    },
    [runs, focusRunId, directiveName]
  )

  useEffect(
    function () {
      if (!directiveName) return
      void fetchRunHistory(directiveName, 20).catch(function (error) {
        console.warn('[directive] 加载运行历史失败', error)
      })
    },
    [fetchRunHistory, directiveName]
  )

  function resolveRunInput(): Record<string, unknown> {
    if (hasDeclaredInputs && !showAdvancedJson) {
      return buildInputPayload(declaredInputs, inputValues)
    }
    return parseJsonObject(paramsJson)
  }

  function handleRun() {
    if (!directiveName) return
    try {
      const input = resolveRunInput()
      useTerminalStore.getState().setActivity('run')
      startRun(directiveName, input)
    } catch (error) {
      toast.error('参数无效', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  function handleTrial() {
    try {
      const params = parseJsonObject(trialParamsJson)
      if (!trialAction) {
        toast.error('请选择动作')
        return
      }
      useTerminalStore.getState().setActivity('trial')
      startTrial(trialAction, params)
    } catch (error) {
      toast.error('试跑参数无效', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function beforeGuard(): Promise<string | null> {
    if (!directiveName) return null
    if (!isDraftDirty()) return directiveName
    try {
      return await saveDraft()
    } catch (error) {
      console.warn('[directive] 保存草稿失败，改为按未保存状态继续:', error)
      return null
    }
  }

  return {
    directiveName,
    declaredInputs,
    hasDeclaredInputs,
    showAdvancedJson,
    inputValues,
    paramsJson,
    trialAction,
    trialParamsJson,
    catalog,
    caps,
    activeRun,
    stepCount,
    runHistory,
    setInputValues,
    setParamsJson,
    setTrialActionPick,
    setTrialParamsJson,
    toggleAdvancedJson: function () {
      setShowAdvancedJson(function (prev) {
        return !prev
      })
    },
    handleRun,
    handleTrial,
    cancelRun,
    beforeGuard
  }
}

export { useRunDock }
