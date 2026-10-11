import { Button } from '@i-thinking/design/components/button'
import { Input } from '@i-thinking/design/components/input'
import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Separator } from '@i-thinking/design/components/separator'
import { Switch } from '@i-thinking/design/components/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@i-thinking/design/components/tabs'
import { Textarea } from '@i-thinking/design/components/textarea'
import { ScrollArea } from '@i-thinking/design/components/scroll-area'
import { useEffect, useState } from 'react'

import { BUCKETS, isValidDirectiveName } from '@/shared/ipc/specs/sidecar'
import { useCorexStore } from '@/stores/corex.ts'
import { findStepKind, replaceStep, switchStepKind } from '@/views/directive/model/step-utils.ts'
import type { ControlKind } from '@/views/directive/model/step-utils.ts'
import type { DirectiveContent, Step } from '@/views/directive/model/types.ts'

import { ConditionField } from '@/views/directive/orchestrator/inspector/condition-field.tsx'
import { ParamFields } from '@/views/directive/orchestrator/inspector/param-fields.tsx'

interface OrchestratorInspectorProps {
  draft: DirectiveContent
  selectedToken: string | null
  onChange: (next: DirectiveContent) => void
}

function findStepByToken(steps: Step[], token: string | null): Step | null {
  if (!token) return null
  for (const step of steps) {
    if ((step.token ?? step.id) === token) return step
    const nested: Step[][] = []
    if ('if' in step) nested.push(step.then, ...(step.else ? [step.else] : []))
    else if ('parallel' in step) nested.push(step.parallel)
    else if ('repeat' in step) nested.push(step.steps)
    else if ('steps' in step && !('action' in step)) nested.push(step.steps)
    for (const list of nested) {
      const found = findStepByToken(list, token)
      if (found) return found
    }
  }
  return null
}

function OrchestratorInspector(props: OrchestratorInspectorProps) {
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const step = findStepByToken(props.draft.steps as Step[], props.selectedToken)
  const nameError =
    props.draft.name && !isValidDirectiveName(props.draft.name) ? '名称不能含路径分隔符或 ..' : null
  const [paramsText, setParamsText] = useState('{}')
  const [paramsError, setParamsError] = useState<string | null>(null)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const [tab, setTab] = useState('step')

  useEffect(
    function () {
      setTab(props.selectedToken ? 'step' : 'directive')
    },
    [props.selectedToken]
  )

  useEffect(
    function () {
      const current = findStepByToken(props.draft.steps as Step[], props.selectedToken)
      if (!current || !('action' in current)) {
        setParamsText('{}')
        setParamsError(null)
        return
      }
      setParamsText(JSON.stringify(current.params ?? {}, null, 2))
      setParamsError(null)
    },
    [props.selectedToken]
  )

  function patchDraft(patch: Partial<DirectiveContent>) {
    props.onChange({ ...props.draft, ...patch })
  }

  function patchStep(next: Step) {
    if (!props.selectedToken) return
    const steps = replaceStep(props.draft.steps as Step[], props.selectedToken, next)
    patchDraft({ steps: steps as DirectiveContent['steps'] })
  }

  const actionMeta =
    step && 'action' in step
      ? catalog.find(function (entry) {
          return entry.id === step.action
        })
      : undefined

  const actionItems = Object.fromEntries(
    catalog.map(function (entry) {
      return [entry.id, entry.id]
    })
  )

  function createDefaultParams(
    params: { name: string; default?: unknown }[]
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {}
    params.forEach(function (param) {
      if (param.default !== undefined) next[param.name] = param.default
    })
    return next
  }

  const directivePanel = (
    <div className="space-y-3">
      <Label htmlFor="directive-name">名称</Label>
      <Input
        id="directive-name"
        value={props.draft.name}
        onChange={function (event) {
          patchDraft({ name: event.target.value })
        }}
      />
      {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
      <Label htmlFor="directive-desc">描述</Label>
      <Textarea
        id="directive-desc"
        value={props.draft.description}
        onChange={function (event) {
          patchDraft({ description: event.target.value })
        }}
        rows={2}
      />
      <Label>分类</Label>
      <Select
        items={{
          __none: '未分类',
          system: 'system',
          network: 'network',
          data: 'data',
          ui: 'ui',
          logic: 'logic',
          plugin: 'plugin'
        }}
        value={props.draft.bucket ?? '__none'}
        onValueChange={function (value) {
          if (value === null) return
          patchDraft({ bucket: value === '__none' ? null : (value as (typeof BUCKETS)[number]) })
        }}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="未分类" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="__none">未分类</SelectItem>
          {BUCKETS.map(function (bucket) {
            return (
              <SelectItem
                key={bucket}
                value={bucket}>
                {bucket}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Label>全局 on_error</Label>
      <Select
        items={{
          default: '默认',
          abort: 'abort（中止）',
          continue: 'continue（继续）',
          skip: 'skip（跳过）'
        }}
        value={props.draft.on_error ?? 'default'}
        onValueChange={function (value) {
          if (value === null) return
          patchDraft({
            on_error: value === 'default' ? undefined : (value as 'abort' | 'continue' | 'skip')
          })
        }}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="默认" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="default">默认</SelectItem>
          <SelectItem value="abort">abort（中止）</SelectItem>
          <SelectItem value="continue">continue（继续）</SelectItem>
          <SelectItem value="skip">skip（跳过）</SelectItem>
        </SelectContent>
      </Select>
      <Separator />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">权限</h3>
      {(['shell', 'filesystem', 'network', 'ui', 'capture', 'clipboard'] as const).map(function (
        key
      ) {
        const checked = props.draft.permissions?.[key] ?? false
        return (
          <label
            key={key}
            className="flex items-center justify-between gap-2">
            <span>{key}</span>
            <Switch
              checked={checked}
              onCheckedChange={function (next) {
                patchDraft({
                  permissions: { ...props.draft.permissions, [key]: next === true }
                })
              }}
            />
          </label>
        )
      })}
    </div>
  )

  const stepPanel = !step ? (
    <p className="text-sm text-muted-foreground">选中画布中的步骤以编辑字段。</p>
  ) : (
    <div className="space-y-3">
      <Label>步骤 id</Label>
      <Input
        value={step.id ?? ''}
        onChange={function (event) {
          patchStep({ ...step, id: event.target.value })
        }}
      />
      {'action' in step ? (
        <>
          <Label>动作</Label>
          <Select
            items={actionItems}
            value={step.action}
            onValueChange={function (value) {
              if (value === null) return
              const next = catalog.find(function (entry) {
                return entry.id === value
              })
              if (!next) return
              const params = createDefaultParams(next.params)
              patchStep({
                ...step,
                action: next.id,
                params
              })
              setParamsText(JSON.stringify(params, null, 2))
              setParamsError(null)
            }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择动作" />
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              className="max-h-72">
              {catalog.map(function (entry) {
                return (
                  <SelectItem
                    key={entry.id}
                    value={entry.id}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{entry.id}</span>
                      {entry.description ? (
                        <span className="text-xs text-muted-foreground line-clamp-1">
                          {entry.description}
                        </span>
                      ) : null}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {actionMeta?.description ? (
            <p className="text-xs text-muted-foreground">{actionMeta.description}</p>
          ) : null}

          <Separator />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            参数
          </h3>
          <ParamFields
            params={actionMeta?.params ?? []}
            values={(step.params ?? {}) as Record<string, unknown>}
            onChange={function (next) {
              patchStep({ ...step, params: next })
              setParamsText(JSON.stringify(next, null, 2))
              setParamsError(null)
            }}
          />

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="px-0"
            onClick={function () {
              setIsAdvancedOpen(function (open) {
                return !open
              })
            }}>
            {isAdvancedOpen ? '收起高级 JSON' : '高级：编辑 params JSON'}
          </Button>
          {isAdvancedOpen ? (
            <>
              <Textarea
                rows={8}
                className="font-mono text-xs"
                value={paramsText}
                onChange={function (event) {
                  setParamsText(event.target.value)
                  try {
                    const parsed = JSON.parse(event.target.value) as unknown
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                      setParamsError('params 必须是 JSON 对象')
                      return
                    }
                    setParamsError(null)
                    patchStep({
                      ...step,
                      params: parsed as Record<string, unknown>
                    })
                  } catch {
                    setParamsError('JSON 无效')
                  }
                }}
              />
              {paramsError ? <p className="text-xs text-destructive">{paramsError}</p> : null}
            </>
          ) : null}

          <Separator />
          <Label>save_to</Label>
          <Input
            value={step.save_to ?? ''}
            onChange={function (event) {
              patchStep({ ...step, save_to: event.target.value || undefined })
            }}
          />
          <Label>retry</Label>
          <Input
            type="number"
            min={0}
            value={step.retry ?? ''}
            onChange={function (event) {
              const n = event.target.value === '' ? undefined : Number(event.target.value)
              patchStep({ ...step, retry: n })
            }}
          />
          <ConditionField
            label="when 条件"
            value={step.when}
            onChange={function (next) {
              patchStep({ ...step, when: next })
            }}
          />
        </>
      ) : null}
      {'if' in step ? (
        <ConditionField
          label="if 条件"
          value={step.if}
          onChange={function (next) {
            if (next !== undefined) patchStep({ ...step, if: next })
          }}
        />
      ) : null}
      {'repeat' in step ? (
        <>
          <Label>count</Label>
          <Input
            type="number"
            min={0}
            value={step.repeat.count ?? ''}
            onChange={function (event) {
              patchStep({
                ...step,
                repeat: {
                  ...step.repeat,
                  count: event.target.value === '' ? undefined : Number(event.target.value)
                }
              })
            }}
          />
          <Label>each</Label>
          <Input
            value={step.repeat.each ?? ''}
            onChange={function (event) {
              patchStep({
                ...step,
                repeat: { ...step.repeat, each: event.target.value || undefined }
              })
            }}
          />
        </>
      ) : null}
      <Label>切换类型</Label>
      <div className="flex flex-wrap gap-1">
        {(['if', 'repeat', 'parallel', 'steps'] as ControlKind[]).map(function (kind) {
          return (
            <Button
              key={kind}
              size="sm"
              variant={findStepKind(step) === kind ? 'default' : 'outline'}
              disabled={'action' in step}
              onClick={function () {
                patchStep(switchStepKind(step, kind))
              }}>
              {kind}
            </Button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col border-l bg-background">
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b px-3 pt-2">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="step">步骤</TabsTrigger>
            <TabsTrigger value="directive">指令</TabsTrigger>
          </TabsList>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 p-3 text-sm">
            <TabsContent
              value="step"
              className="mt-0">
              {stepPanel}
            </TabsContent>
            <TabsContent
              value="directive"
              className="mt-0">
              {directivePanel}
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  )
}

export { OrchestratorInspector }
