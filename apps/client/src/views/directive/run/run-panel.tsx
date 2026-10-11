import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import { Progress } from '@i-thinking/design/components/progress'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { Textarea } from '@i-thinking/design/components/textarea'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { useCorexStore } from '@/stores/corex.ts'
import { useRunFrames, type CorexFrame } from '@/stores/run-logs.ts'
import type { DirectiveInput } from '@/shared/ipc/specs/sidecar'

import { capsFromTriggers } from './run-caps'
import { RunMenu } from './run-menu'
import { RUN_STATUS_STYLES } from './run-status'

interface RunPanelProps {
  directiveName: string
}

const BOTTOM_GAP = 32

function normalizeLogText(text: string): string {
  return text
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

function formatControlLine(frame: Exclude<CorexFrame, { kind: 'step_output' }>): string {
  if (frame.kind === 'step_start') {
    return `▶ 开始  ${frame.step} · ${frame.action}`
  }
  if (frame.kind === 'step_end') {
    const mark = frame.ok === false ? '✗' : '✓'
    const took = frame.took_ms != null ? `  (${frame.took_ms}ms)` : ''
    return `${mark} 结束  ${frame.step} · ${frame.action}${took}`
  }
  const total = frame.total != null ? `/${frame.total}` : ''
  const unit = frame.unit ? ` ${frame.unit}` : ''
  const done = frame.done != null ? `${frame.done}${total}${unit}` : '进行中'
  return `… 进度  ${frame.step} · ${done}`
}

function formatRunLogText(frames: readonly CorexFrame[]): string {
  const lines: string[] = []
  let pendingOutput = ''

  function flushOutput() {
    if (!pendingOutput) return
    lines.push(pendingOutput.replace(/\n+$/, ''))
    pendingOutput = ''
  }

  frames.forEach(function (frame) {
    if (frame.kind === 'step_output') {
      const stream = frame.stream === 'stderr' ? 'stderr' : 'stdout'
      const chunk = normalizeLogText(frame.text ?? '')
      if (!chunk) return
      const header = `[${stream}] ${frame.step}`
      if (!pendingOutput.startsWith(`${header}\n`) && pendingOutput !== header) {
        flushOutput()
        pendingOutput = `${header}\n${chunk}`
      } else {
        pendingOutput += chunk
      }
      return
    }
    flushOutput()
    lines.push(formatControlLine(frame))
  })
  flushOutput()
  return lines.join('\n')
}

function seedInputValues(inputs: DirectiveInput[]): Record<string, string> {
  const values: Record<string, string> = {}
  inputs.forEach(function (input) {
    if (input.default === undefined || input.default === null) {
      values[input.name] = ''
      return
    }
    values[input.name] =
      typeof input.default === 'string' ? input.default : JSON.stringify(input.default)
  })
  return values
}

function buildInputPayload(
  inputs: DirectiveInput[],
  values: Record<string, string>
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  inputs.forEach(function (input) {
    const raw = values[input.name] ?? ''
    if (raw === '') {
      if (input.required) throw new Error(`请填写 ${input.name}`)
      return
    }
    try {
      payload[input.name] = JSON.parse(raw) as unknown
    } catch {
      payload[input.name] = raw
    }
  })
  return payload
}

function RunPanel(props: RunPanelProps) {
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

  const [tab, setTab] = useState('run')
  const [paramsJson, setParamsJson] = useState('{}')
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [showAdvancedJson, setShowAdvancedJson] = useState(false)
  const [trialAction, setTrialAction] = useState('')
  const [trialParamsJson, setTrialParamsJson] = useState('{}')
  const [isFollowing, setFollowing] = useState(true)
  const logScrollerRef = useRef<HTMLDivElement | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const declaredInputsRef = useRef<DirectiveInput[]>([])

  const declaredInputs = useMemo(
    function () {
      if (draft && editorName === props.directiveName) return draft.inputs ?? []
      return [] as DirectiveInput[]
    },
    [draft, editorName, props.directiveName]
  )
  declaredInputsRef.current = declaredInputs

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

  const hasDeclaredInputs = declaredInputs.length > 0

  const caps = useMemo(
    function () {
      return capsFromTriggers(draft?.triggers)
    },
    [draft?.triggers]
  )

  const stepCount = useMemo(
    function () {
      if (draft && editorName === props.directiveName) {
        return Array.isArray(draft.steps) ? draft.steps.length : 0
      }
      const entry = directives.find(function (item) {
        return item.name === props.directiveName
      })
      return entry?.summary?.step_count ?? 0
    },
    [draft, editorName, props.directiveName, directives]
  )

  const activeRun = useMemo(
    function () {
      const byFocus = runs.find(function (run) {
        return run.id === focusRunId
      })
      if (byFocus) return byFocus
      return runs.find(function (run) {
        return run.name === props.directiveName && run.status === 'running'
      })
    },
    [runs, focusRunId, props.directiveName]
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
      void fetchRunHistory(props.directiveName, 20).catch(function (error) {
        console.warn('[directive] 加载运行历史失败', error)
      })
    },
    [fetchRunHistory, props.directiveName]
  )

  useEffect(
    function () {
      if (!trialAction && catalog[0]) setTrialAction(catalog[0].id)
    },
    [catalog, trialAction]
  )

  useEffect(
    function () {
      if (!inputSignature) {
        setParamsJson('{}')
        setShowAdvancedJson(true)
        return
      }
      setInputValues(seedInputValues(declaredInputsRef.current))
      setShowAdvancedJson(false)
    },
    [props.directiveName, inputSignature]
  )

  useEffect(
    function () {
      if (activeRun?.status === 'running') setFollowing(true)
    },
    [activeRun?.id, activeRun?.status]
  )

  useEffect(
    function () {
      if (!isFollowing) return
      const scroller = logScrollerRef.current
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight
        return
      }
      logEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    },
    [logText, isFollowing]
  )

  function parseJsonObject(text: string): Record<string, unknown> {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('需要 JSON 对象')
    }
    return parsed as Record<string, unknown>
  }

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
      startRun(props.directiveName, input)
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
    if (!isDraftDirty()) return props.directiveName
    try {
      return await saveDraft()
    } catch {
      return null
    }
  }

  function handleLogScroll() {
    const scroller = logScrollerRef.current
    if (!scroller) return
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    const atBottom = gap <= BOTTOM_GAP
    if (atBottom !== isFollowing) setFollowing(atBottom)
  }

  const statusStyle = activeRun ? RUN_STATUS_STYLES[activeRun.status] : null
  const progressValue =
    activeRun && stepCount > 0
      ? Math.min(100, (activeRun.doneSteps / stepCount) * 100)
      : activeRun?.status === 'running'
        ? 8
        : activeRun?.status === 'ok'
          ? 100
          : 0

  const logPane = (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-muted/30">
      <div
        ref={logScrollerRef}
        onScroll={handleLogScroll}
        className="absolute inset-0 overflow-auto overscroll-contain p-2"
        style={{ overflowAnchor: 'none' }}>
        <pre className="m-0 min-h-full w-full whitespace-pre-wrap break-words font-mono text-xs leading-5">
          {logText ||
            (tab === 'trial' ? '试跑输出将显示在这里…' : '运行日志将显示在这里…')}
        </pre>
        <div
          ref={logEndRef}
          aria-hidden
          className="h-px w-full"
        />
      </div>
    </div>
  )

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
          <div className="grid shrink-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0 space-y-2">
              {hasDeclaredInputs && !showAdvancedJson ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {declaredInputs.map(function (input) {
                    return (
                      <div
                        key={input.name}
                        className="min-w-0 space-y-1">
                        <Label
                          htmlFor={`run-input-${input.name}`}
                          className="text-xs">
                          {input.name}
                          {input.required ? (
                            <span className="text-destructive"> *</span>
                          ) : null}
                        </Label>
                        <Input
                          id={`run-input-${input.name}`}
                          value={inputValues[input.name] ?? ''}
                          placeholder={input.description || '值或 JSON'}
                          onChange={function (event) {
                            const next = event.target.value
                            setInputValues(function (prev) {
                              return { ...prev, [input.name]: next }
                            })
                          }}
                          className="h-8 font-mono text-xs"
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="min-w-0 space-y-1">
                  <Label
                    htmlFor="run-params"
                    className="text-xs">
                    输入参数 (JSON)
                  </Label>
                  <Textarea
                    id="run-params"
                    value={paramsJson}
                    onChange={function (event) {
                      setParamsJson(event.target.value)
                    }}
                    rows={2}
                    className="max-h-24 min-h-12 resize-y font-mono text-xs"
                  />
                </div>
              )}
              {hasDeclaredInputs ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1 text-xs text-muted-foreground"
                  onClick={function () {
                    setShowAdvancedJson(function (prev) {
                      return !prev
                    })
                  }}>
                  {showAdvancedJson ? '使用表单' : '高级 JSON'}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <RunMenu
                name={props.directiveName}
                caps={caps}
                onOnce={handleRun}
                beforeGuard={beforeGuard}
              />
              {activeRun?.status === 'running' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={function () {
                    void cancelRun(activeRun.id)
                  }}>
                  取消
                </Button>
              ) : null}
            </div>
          </div>

          {activeRun ? (
            <div className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                {statusStyle ? (
                  <Badge
                    variant={
                      activeRun.status === 'ok'
                        ? 'success'
                        : activeRun.status === 'failed'
                          ? 'destructive'
                          : 'outline'
                    }
                    className={cn(
                      'gap-1.5 font-normal',
                      activeRun.status === 'running' && statusStyle.tone
                    )}>
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        statusStyle.dot,
                        activeRun.status === 'running' && 'animate-pulse'
                      )}
                    />
                    {statusStyle.label}
                  </Badge>
                ) : null}
                <span className="truncate font-medium">{activeRun.name}</span>
                {stepCount > 0 ? (
                  <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                    {activeRun.doneSteps}/{stepCount} 步
                  </span>
                ) : null}
                {!isFollowing ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-6 px-2 text-xs"
                    onClick={function () {
                      setFollowing(true)
                    }}>
                    回到底部
                  </Button>
                ) : null}
              </div>
              <Progress
                className="mt-1.5 h-1"
                value={progressValue}
              />
              {activeRun.error ? (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-destructive">
                  {activeRun.error}
                </p>
              ) : null}
            </div>
          ) : null}

          {tab === 'run' ? logPane : null}
        </TabsContent>

        <TabsContent
          value="trial"
          className="mt-0 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-3 pt-2">
          <div className="grid shrink-0 max-w-xl gap-2">
            <Label>动作</Label>
            <Select
              items={Object.fromEntries(
                catalog.map(function (entry) {
                  return [entry.id, entry.id]
                })
              )}
              value={trialAction || undefined}
              onValueChange={function (value) {
                if (value) setTrialAction(value)
              }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择要试跑的动作" />
              </SelectTrigger>
              <SelectContent
                alignItemWithTrigger={false}
                className="max-h-72">
                {catalog.map(function (entry) {
                  return (
                    <SelectItem
                      key={entry.id}
                      value={entry.id}>
                      {entry.id}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <Label>参数 (JSON)</Label>
            <Textarea
              value={trialParamsJson}
              onChange={function (event) {
                setTrialParamsJson(event.target.value)
              }}
              rows={3}
              className="font-mono text-xs"
            />
            <Button
              size="sm"
              className="w-fit"
              onClick={handleTrial}>
              试跑
            </Button>
          </div>
          {tab === 'trial' ? logPane : null}
        </TabsContent>

        <TabsContent
          value="history"
          className="mt-0 min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-2">
          {!runHistory?.is_history_enabled ? (
            <p className="py-2 text-sm text-muted-foreground">运行历史未启用。</p>
          ) : (
            <ScrollArea className="h-full">
              <ul className="space-y-1 py-1 text-xs">
                {runHistory.entries.map(function (entry, index) {
                  return (
                    <li
                      key={`${entry.started_at_ms}-${index}`}
                      className="rounded border px-2 py-1">
                      <span className="font-medium">{entry.directive}</span>
                      <Badge
                        className="ml-2"
                        variant={entry.ok ? 'success' : 'destructive'}>
                        {entry.ok ? '成功' : '失败'}
                      </Badge>
                      <span className="ml-2 text-muted-foreground">{entry.duration_ms}ms</span>
                      {entry.error ? (
                        <p className="text-destructive">{entry.error}</p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export { RunPanel }
