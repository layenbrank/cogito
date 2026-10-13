import { toast } from 'sonner'
import { create } from 'zustand'

import {
  cancelExecution,
  deleteDirective,
  fetchActions,
  fetchDirective,
  fetchDirectives,
  importDirectives,
  invokeAction,
  listenProgress,
  listRuns,
  runDirective,
  saveDirective,
  validateDirective,
  type ActionEntry,
  type DirectiveDocument,
  type DirectiveEntry,
  type ImportResult,
  type ListRunsReply
} from '@/lib/directive-ipc.ts'
import type { DirectiveContent } from '@/shared/ipc/specs/sidecar'
import { createDirective } from '@/views/directive/model/draft.ts'
import { sanitizeSteps, stampSteps } from '@/views/directive/model/step-utils.ts'

import type { CorexProgress } from './run-logs'
import {
  appendRunFrame,
  dropRunFrames,
  flushRunFrames,
  registerRun,
  unregisterRun
} from './run-logs'

type CorexAction = ActionEntry

type RunStatus = 'running' | 'ok' | 'failed'

const MAX_FINISHED_RUNS = 100
const MAX_UNDO = 50

type RunTrigger = 'manual' | 'cron' | 'watch'

interface CorexRun {
  id: string
  name: string
  status: RunStatus
  startedAt: Date
  endedAt: Date | null
  doneSteps: number
  result: unknown
  error: string | null
  targetId?: number
  /** 触发来源；缺省视为手动 */
  trigger?: RunTrigger
  /** 优雅停止中（cron/watch） */
  isStopping?: boolean
}

interface CorexStore {
  catalog: CorexAction[]
  directives: DirectiveEntry[]
  isLoaded: boolean
  isLoading: boolean
  loadError: string | null
  runs: CorexRun[]
  focusRunId: string | null
  runHistory: ListRunsReply | null

  editorName: string | null
  originalName: string | null
  draft: DirectiveContent | null
  baselineJson: string | null
  undoStack: DirectiveContent[]
  redoStack: DirectiveContent[]
  selectedToken: string | null
  isEditorLoading: boolean
  isSaving: boolean

  initialize: () => Promise<void>
  refreshDirectives: () => Promise<void>
  loadDirective: (name: string) => Promise<DirectiveDocument>
  saveDirectiveToHost: (content: DirectiveContent, originalName?: string) => Promise<DirectiveDocument>
  deleteDirectiveFromHost: (name: string) => Promise<void>
  importDirectivesFromHost: (options: {
    path: string
    folder?: string
    is_overwrite?: boolean
    is_dry_run?: boolean
  }) => Promise<ImportResult>
  fetchRunHistory: (name?: string, limit?: number) => Promise<ListRunsReply>

  openEditor: (name: string, pending?: boolean) => void
  seedPendingDraft: (name: string) => void
  loadEditor: (name: string) => Promise<void>
  closeEditor: () => void
  setSelectedToken: (token: string | null) => void
  replaceDraft: (next: DirectiveContent, recordHistory?: boolean) => void
  undoDraft: () => void
  redoDraft: () => void
  isDraftDirty: () => boolean
  validateDraft: () => Promise<void>
  saveDraft: () => Promise<string | null>

  startRun: (name: string, input: Record<string, unknown>) => string
  startTrial: (actionId: string, params: Record<string, unknown>) => string
  cancelRun: (runId: string) => Promise<void>
  removeRun: (id: string) => void
  clearRuns: () => void
  clearFocusRun: () => void
  /** 强制终止：把该指令下对应触发的进行中任务标失败 */
  cancelTriggerRuns: (name: string, kind: 'cron' | 'watch') => void
  /** 优雅停止：标记触发任务正在收尾 */
  markTriggerStopping: (name: string, kind: 'cron' | 'watch') => void
}

let unsubscribeProgress: (() => void) | null = null
let runSeq = 0

function nextRunId(): string {
  runSeq += 1
  return `run-${Date.now().toString(36)}-${runSeq}`
}

function snapshotDraft(content: DirectiveContent): string {
  const clone = structuredClone(content)
  clone.steps = sanitizeSteps(clone.steps as Parameters<typeof sanitizeSteps>[0]) as DirectiveContent['steps']
  return JSON.stringify(clone)
}

function partitionRuns(runs: readonly CorexRun[]): [CorexRun[], CorexRun[]] {
  const alive: CorexRun[] = []
  const finished: CorexRun[] = []
  runs.forEach(function (run) {
    if (run.status === 'running') alive.push(run)
    else finished.push(run)
  })
  return [alive, finished]
}

function retainRuns(runs: readonly CorexRun[]): { kept: CorexRun[]; evicted: string[] } {
  const finishedCount = runs.reduce(function (count, run) {
    return count + (run.status === 'running' ? 0 : 1)
  }, 0)
  const excess = finishedCount - MAX_FINISHED_RUNS
  if (excess <= 0) return { kept: [...runs], evicted: [] }

  const evicted: string[] = []
  let remaining = excess
  const kept = runs.filter(function (run) {
    if (run.status === 'running') return true
    if (remaining > 0) {
      remaining -= 1
      evicted.push(run.id)
      return false
    }
    return true
  })
  return { kept, evicted }
}

function commitRuns(runs: readonly CorexRun[]): { runs: CorexRun[] } {
  const { kept, evicted } = retainRuns(runs)
  dropRunFrames(evicted)
  return { runs: kept }
}

function reuseSeat(runs: readonly CorexRun[], next: CorexRun): CorexRun[] {
  registerRun(next.id)
  const index = runs.findIndex(function (run) {
    return run.name === next.name
  })
  if (index < 0) return [...runs, next]
  const prev = runs[index]
  if (prev.id !== next.id) dropRunFrames([prev.id])
  const copied = [...runs]
  copied[index] = next
  return copied
}

function parseErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}

const useCorexStore = create<CorexStore>(function (setter, getter) {
  function patchRun(id: string, patch: Partial<CorexRun> | ((run: CorexRun) => Partial<CorexRun>)) {
    flushRunFrames()
    const runs = getter().runs.map(function (run) {
      if (run.id !== id) return run
      return { ...run, ...(typeof patch === 'function' ? patch(run) : patch) }
    })
    setter(commitRuns(runs))
  }

  function pushUndoSnapshot() {
    const draft = getter().draft
    if (!draft) return
    const stack = [...getter().undoStack, structuredClone(draft)]
    if (stack.length > MAX_UNDO) stack.shift()
    setter({ undoStack: stack, redoStack: [] })
  }

  return {
    catalog: [],
    directives: [],
    isLoaded: false,
    isLoading: false,
    loadError: null,
    runs: [],
    focusRunId: null,
    runHistory: null,

    editorName: null,
    originalName: null,
    draft: null,
    baselineJson: null,
    undoStack: [],
    redoStack: [],
    selectedToken: null,
    isEditorLoading: false,
    isSaving: false,

    async initialize() {
      if (getter().isLoading) return
      setter({ isLoading: true, loadError: null })

      function applyProgressFrame(frame: CorexProgress) {
        if (frame.kind === 'started') {
          patchRun(frame.runId, { targetId: frame.requestId })
          return
        }
        appendRunFrame({ ...frame, receivedAt: new Date() })
        if (frame.kind === 'step_end') {
          patchRun(frame.runId, function (run) {
            return { doneSteps: run.doneSteps + 1 }
          })
        }
      }

      if (unsubscribeProgress) {
        unsubscribeProgress()
        unsubscribeProgress = null
      }
      unsubscribeProgress = listenProgress(applyProgressFrame)

      try {
        const [catalog, directives] = await Promise.all([fetchActions(), fetchDirectives()])
        setter({ catalog, directives, isLoaded: true, isLoading: false, loadError: null })
      } catch (error) {
        console.error('[corex] 初始化失败', error)
        setter({
          isLoaded: false,
          isLoading: false,
          loadError: parseErrorMessage(error, 'corex 初始化失败')
        })
      }
    },

    async refreshDirectives() {
      try {
        setter({ directives: await fetchDirectives() })
      } catch (error) {
        console.error('[corex] 重读指令目录失败', error)
        toast.error('重新读取指令目录失败', {
          description: parseErrorMessage(error, '')
        })
      }
    },

    loadDirective(name) {
      return fetchDirective(name)
    },

    saveDirectiveToHost(content, originalName) {
      return saveDirective({
        definition: content,
        ...(originalName ? { original_name: originalName } : {})
      })
    },

    async deleteDirectiveFromHost(name) {
      await deleteDirective(name)
    },

    importDirectivesFromHost(options) {
      return importDirectives(options)
    },

    async fetchRunHistory(name, limit) {
      const reply = await listRuns({ name, limit })
      setter({ runHistory: reply })
      return reply
    },

    openEditor(name, pending) {
      setter({
        editorName: name,
        originalName: pending ? null : name,
        draft: null,
        baselineJson: null,
        undoStack: [],
        redoStack: [],
        selectedToken: null
      })
    },

    seedPendingDraft(name) {
      const content = createDirective(name)
      const stamped = {
        ...content,
        steps: stampSteps(content.steps as Parameters<typeof stampSteps>[0])
      } as DirectiveContent
      setter({
        draft: stamped,
        originalName: null,
        baselineJson: snapshotDraft(stamped),
        undoStack: [],
        redoStack: [],
        isEditorLoading: false
      })
    },

    async loadEditor(name) {
      setter({ isEditorLoading: true, editorName: name })
      try {
        const doc = await fetchDirective(name)
        const stamped = {
          ...doc.definition,
          steps: stampSteps(doc.definition.steps as Parameters<typeof stampSteps>[0])
        } as DirectiveContent
        setter({
          draft: stamped,
          originalName: name,
          baselineJson: snapshotDraft(stamped),
          isEditorLoading: false,
          undoStack: [],
          redoStack: []
        })
      } catch (error) {
        setter({ isEditorLoading: false })
        throw error
      }
    },

    closeEditor() {
      setter({
        editorName: null,
        originalName: null,
        draft: null,
        baselineJson: null,
        undoStack: [],
        redoStack: [],
        selectedToken: null
      })
    },

    setSelectedToken(token) {
      setter({ selectedToken: token })
    },

    replaceDraft(next, recordHistory) {
      if (recordHistory !== false) pushUndoSnapshot()
      setter({ draft: next })
    },

    undoDraft() {
      const undoStack = getter().undoStack
      const draft = getter().draft
      if (undoStack.length === 0 || !draft) return
      const prev = undoStack[undoStack.length - 1]
      setter({
        draft: structuredClone(prev),
        undoStack: undoStack.slice(0, -1),
        redoStack: [...getter().redoStack, structuredClone(draft)]
      })
    },

    redoDraft() {
      const redoStack = getter().redoStack
      const draft = getter().draft
      if (redoStack.length === 0 || !draft) return
      const next = redoStack[redoStack.length - 1]
      setter({
        draft: structuredClone(next),
        redoStack: redoStack.slice(0, -1),
        undoStack: [...getter().undoStack, structuredClone(draft)]
      })
    },

    isDraftDirty() {
      const draft = getter().draft
      const baseline = getter().baselineJson
      if (!draft || !baseline) return false
      return snapshotDraft(draft) !== baseline
    },

    async validateDraft() {
      const draft = getter().draft
      if (!draft) throw new Error('没有可校验的草稿')
      const payload = {
        ...draft,
        steps: sanitizeSteps(draft.steps as Parameters<typeof sanitizeSteps>[0])
      } as DirectiveContent
      await validateDirective({ definition: payload })
    },

    async saveDraft() {
      const draft = getter().draft
      if (!draft) return null
      setter({ isSaving: true })
      try {
        const payload = {
          ...draft,
          steps: sanitizeSteps(draft.steps as Parameters<typeof sanitizeSteps>[0])
        } as DirectiveContent
        await validateDirective({ definition: payload })
        const originalName = getter().originalName
        const saved = await saveDirective({
          definition: payload,
          ...(originalName ? { original_name: originalName } : {})
        })
        const stamped = {
          ...saved.definition,
          steps: stampSteps(saved.definition.steps as Parameters<typeof stampSteps>[0])
        } as DirectiveContent
        setter({
          draft: stamped,
          originalName: saved.name,
          editorName: saved.name,
          baselineJson: snapshotDraft(stamped),
          undoStack: [],
          redoStack: [],
          isSaving: false
        })
        await getter().refreshDirectives()
        toast.success('指令已保存')
        return saved.name
      } catch (error) {
        setter({ isSaving: false })
        toast.error('保存失败', { description: parseErrorMessage(error, '') })
        throw error
      }
    },

    startRun(name, input) {
      const current = getter().runs
      const alive = current.find(function (run) {
        return run.name === name && run.status === 'running'
      })
      if (alive) {
        toast.message(`「${name}」已在运行`)
        setter({ focusRunId: alive.id })
        return alive.id
      }

      const id = nextRunId()
      registerRun(id)
      const run: CorexRun = {
        id,
        name,
        status: 'running',
        startedAt: new Date(),
        endedAt: null,
        doneSteps: 0,
        result: null,
        error: null,
        trigger: 'manual'
      }
      setter({ ...commitRuns(reuseSeat(current, run)), focusRunId: id })

      void (async function () {
        try {
          const result = await runDirective({ name, input, runId: id })
          patchRun(id, { status: 'ok', result, endedAt: new Date() })
          void getter().fetchRunHistory(name, 20)
        } catch (error) {
          console.warn('[corex] 指令运行失败:', error)
          patchRun(id, {
            status: 'failed',
            error: parseErrorMessage(error, '运行失败'),
            endedAt: new Date()
          })
        } finally {
          unregisterRun(id)
        }
      })()

      return id
    },

    startTrial(actionId, params) {
      const id = nextRunId()
      registerRun(id)
      const run: CorexRun = {
        id,
        name: actionId,
        status: 'running',
        startedAt: new Date(),
        endedAt: null,
        doneSteps: 0,
        result: null,
        error: null,
        trigger: 'manual'
      }
      setter({ ...commitRuns([...getter().runs, run]), focusRunId: id })

      void (async function () {
        try {
          const result = await invokeAction({ action: actionId, params, runId: id })
          patchRun(id, { status: 'ok', result, doneSteps: 1, endedAt: new Date() })
        } catch (error) {
          console.warn('[corex] 动作试跑失败:', error)
          patchRun(id, {
            status: 'failed',
            error: parseErrorMessage(error, '试跑失败'),
            endedAt: new Date()
          })
        } finally {
          unregisterRun(id)
        }
      })()

      return id
    },

    async cancelRun(runId) {
      const run = getter().runs.find(function (item) {
        return item.id === runId
      })
      if (!run?.targetId) {
        toast.message('暂无法取消', { description: '缺少执行 target_id' })
        return
      }
      try {
        await cancelExecution(run.targetId)
        toast.message('已请求取消')
      } catch (error) {
        toast.error('取消失败', { description: parseErrorMessage(error, '') })
      }
    },

    removeRun(id) {
      dropRunFrames([id])
      setter(function (state) {
        return {
          runs: state.runs.filter(function (run) {
            return run.id !== id
          })
        }
      })
    },

    clearRuns() {
      const [alive, finished] = partitionRuns(getter().runs)
      dropRunFrames(
        finished.map(function (run) {
          return run.id
        })
      )
      setter({ runs: alive })
    },

    clearFocusRun() {
      setter({ focusRunId: null })
    },

    cancelTriggerRuns(name, kind) {
      flushRunFrames()
      setter(function (state) {
        const runs = state.runs.map(function (run) {
          if (run.name !== name || run.status !== 'running' || run.trigger !== kind) return run
          return {
            ...run,
            status: 'failed' as const,
            error: '守护已强制终止',
            endedAt: new Date(),
            isStopping: false
          }
        })
        return commitRuns(runs)
      })
    },

    markTriggerStopping(name, kind) {
      flushRunFrames()
      setter(function (state) {
        return {
          runs: state.runs.map(function (run) {
            if (run.name !== name || run.status !== 'running' || run.trigger !== kind) return run
            return { ...run, isStopping: true }
          })
        }
      })
    }
  }
})

export { useCorexStore }
export type { CorexAction, CorexRun, RunStatus, RunTrigger }
