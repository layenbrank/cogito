import { Tabs, TabsContent, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { useCorexStore } from '@/stores/corex.ts'
import { useRunFrames } from '@/stores/run-logs.ts'
import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'

import { capsFromTriggers } from './run-caps'
import { buildInputPayload, parseJsonObject, seedInputValues } from './run-input-utils.ts'
import { formatRunLogText } from './run-log-text.ts'
import { RunPanelHistoryTab } from './run-panel-history-tab.tsx'
import { RunPanelRunTab } from './run-panel-run-tab.tsx'
import { RunPanelTrialTab } from './run-panel-trial-tab.tsx'

interface RunPanelProps {
  directiveName: string
}

function RunPanel(props: RunPanelProps) {
  const directiveName = props.directiveName
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

  const runFieldsKey = `${directiveName}:${inputSignature}`

  return (
    <RunPanelView
      key={runFieldsKey}
      directiveName={directiveName}
      declaredInputs={declaredInputs}
      catalog={catalog}
      draft={draft}
      editorName={editorName}
      directives={directives}
      runs={runs}
      focusRunId={focusRunId}
      runHistory={runHistory}
      startRun={startRun}
      startTrial={startTrial}
      cancelRun={cancelRun}
      fetchRunHistory={fetchRunHistory}
      saveDraft={saveDraft}
      isDraftDirty={isDraftDirty}
    />
  )
}

interface RunPanelViewProps {
  directiveName: string
  declaredInputs: DirectiveInput[]
  catalog: ReturnType<typeof useCorexStore.getState>['catalog']
  draft: ReturnType<typeof useCorexStore.getState>['draft']
  editorName: ReturnType<typeof useCorexStore.getState>['editorName']
  directives: ReturnType<typeof useCorexStore.getState>['directives']
  runs: ReturnType<typeof useCorexStore.getState>['runs']
  focusRunId: ReturnType<typeof useCorexStore.getState>['focusRunId']
  runHistory: ReturnType<typeof useCorexStore.getState>['runHistory']
  startRun: ReturnType<typeof useCorexStore.getState>['startRun']
  startTrial: ReturnType<typeof useCorexStore.getState>['startTrial']
  cancelRun: ReturnType<typeof useCorexStore.getState>['cancelRun']
  fetchRunHistory: ReturnType<typeof useCorexStore.getState>['fetchRunHistory']
  saveDraft: ReturnType<typeof useCorexStore.getState>['saveDraft']
  isDraftDirty: ReturnType<typeof useCorexStore.getState>['isDraftDirty']
}

function RunPanelView(props: RunPanelViewProps) {
  const { directiveName, declaredInputs, catalog, draft, editorName, directives, runs, focusRunId, runHistory, startRun, startTrial, cancelRun, fetchRunHistory, saveDraft, isDraftDirty } =
    props

  const [tab, setTab] = useState('run')
  const hasInputsOnMount = declaredInputs.length > 0
  const [paramsJson, setParamsJson] = useState('{}')
  const [inputValues, setInputValues] = useState<Record<string, string>>(function () {
    return hasInputsOnMount ? seedInputValues(declaredInputs) : {}
  })
  const [showAdvancedJson, setShowAdvancedJson] = useState(!hasInputsOnMount)
  const [trialActionPick, setTrialActionPick] = useState<string | null>(null)
  const trialAction = trialActionPick ?? catalog[0]?.id ?? ''
  const [trialParamsJson, setTrialParamsJson] = useState('{}')
  const [isFollowing, setFollowing] = useState(true)

  const hasDeclaredInputs = declaredInputs.length > 0

  const caps = useMemo(
    function () {
      return capsFromTriggers(draft?.triggers)
    },
    [draft?.triggers]
  )

  const stepCount = useMemo(
    function () {
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
      return runs.find(function (run) {
        return run.name === directiveName && run.status === 'running'
      })
    },
    [runs, focusRunId, directiveName]
  )

  const frames = useRunFrames(activeRun?.id ?? null)

  const logText = useMemo(
    function () {
      return formatRunLogText(frames.frames)
    },
    [frames.frames]
  )

  useEffect(
    function () {
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
    try {
      const input = resolveRunInput()
      setFollowing(true)
      setTab('run')
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
      setFollowing(true)
      setTab('trial')
      startTrial(trialAction, params)
    } catch (error) {
      toast.error('试跑参数无效', {
        description: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async function beforeGuard(): Promise<string | null> {
    if (!isDraftDirty()) return directiveName
    try {
      return await saveDraft()
    } catch {
      return null
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t bg-background">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 flex-col gap-0">
        <TabsList className="mx-3 mt-2 shrink-0 self-start">
          <TabsTrigger value="run">运行</TabsTrigger>
          <TabsTrigger value="trial">试跑动作</TabsTrigger>
          <TabsTrigger value="history">历史</TabsTrigger>
        </TabsList>

        <TabsContent
          value="run"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-2">
          {tab === 'run' ? (
            <RunPanelRunTab
              directiveName={directiveName}
              caps={caps}
              declaredInputs={declaredInputs}
              hasDeclaredInputs={hasDeclaredInputs}
              showAdvancedJson={showAdvancedJson}
              inputValues={inputValues}
              paramsJson={paramsJson}
              activeRun={activeRun}
              stepCount={stepCount}
              logText={logText}
              isFollowing={isFollowing}
              onInputValuesChange={setInputValues}
              onParamsJsonChange={setParamsJson}
              onToggleAdvancedJson={function () {
                setShowAdvancedJson(function (prev) {
                  return !prev
                })
              }}
              onRun={handleRun}
              onCancelRun={function (runId) {
                void cancelRun(runId)
              }}
              beforeGuard={beforeGuard}
              onFollowingChange={setFollowing}
              onResumeFollow={function () {
                setFollowing(true)
              }}
            />
          ) : null}
        </TabsContent>

        <TabsContent
          value="trial"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-2">
          {tab === 'trial' ? (
            <RunPanelTrialTab
              catalog={catalog}
              trialAction={trialAction}
              trialParamsJson={trialParamsJson}
              logText={logText}
              isFollowing={isFollowing}
              onTrialActionChange={setTrialActionPick}
              onTrialParamsJsonChange={setTrialParamsJson}
              onTrial={handleTrial}
              onFollowingChange={setFollowing}
            />
          ) : null}
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-0 min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
          <RunPanelHistoryTab runHistory={runHistory} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export { RunPanel }
