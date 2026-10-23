import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Separator } from '@cogito/design/components/separator'
import { Textarea } from '@cogito/design/components/textarea'
import { useState } from 'react'

import type { ActionEntry } from '@/lib/directive-ipc.ts'
import { findStepKind, switchStepKind } from '@/views/directive/model/step-utils.ts'
import type { ControlKind } from '@/views/directive/model/step-utils.ts'
import type { Step } from '@/views/directive/model/types.ts'

import { ConditionField } from '@/views/directive/orchestrator/inspector/condition-field.tsx'
import { ParamFields } from '@/views/directive/orchestrator/inspector/param-fields.tsx'
import type { ParamRefContext } from '@/views/directive/orchestrator/inspector/param-ref.ts'

interface StepParamsJsonEditorProps {
  step: Step
  isAdvancedOpen: boolean
  onToggleAdvanced: () => void
  onPatchParams: (params: Record<string, unknown>) => void
}

function StepParamsJsonEditor(props: StepParamsJsonEditorProps) {
  const seed = 'action' in props.step ? JSON.stringify(props.step.params ?? {}, null, 2) : '{}'
  const [paramsText, setParamsText] = useState(seed)
  const [paramsError, setParamsError] = useState<string | null>(null)

  if (!('action' in props.step)) return null

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="px-0"
        onClick={props.onToggleAdvanced}>
        {props.isAdvancedOpen ? '收起高级 JSON' : '高级：编辑 params JSON'}
      </Button>
      {props.isAdvancedOpen ? (
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
                props.onPatchParams(parsed as Record<string, unknown>)
              } catch (error) {
                // 界面上已经标了「JSON 无效」，控制台补一条便于定位是哪次输入
                console.debug('[directive] 步骤参数 JSON 解析失败:', error)
                setParamsError('JSON 无效')
              }
            }}
          />
          {paramsError ? <p className="text-xs text-destructive">{paramsError}</p> : null}
        </>
      ) : null}
    </>
  )
}

function createDefaultParams(
  params: { name: string; default?: unknown }[]
): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  params.forEach(function (param) {
    if (param.default !== undefined) next[param.name] = param.default
  })
  return next
}

interface StepPanelProps {
  step: Step | null
  selectedToken: string | null
  catalog: ActionEntry[]
  refContext: ParamRefContext
  onPatchStep: (next: Step) => void
}

function StepPanel(props: StepPanelProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)
  const step = props.step

  if (!step) {
    return <p className="text-sm text-muted-foreground">选中画布中的步骤以编辑字段。</p>
  }

  const actionMeta =
    'action' in step
      ? props.catalog.find(function (entry) {
          return entry.id === step.action
        })
      : undefined

  const actionItems = Object.fromEntries(
    props.catalog.map(function (entry) {
      return [entry.id, entry.id]
    })
  )

  function patchStep(next: Step) {
    props.onPatchStep(next)
  }

  return (
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
              const next = props.catalog.find(function (entry) {
                return entry.id === value
              })
              if (!next) return
              const params = createDefaultParams(next.params)
              patchStep({
                ...step,
                action: next.id,
                params
              })
            }}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择动作" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {props.catalog.map(function (entry) {
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
            values={step.params ?? {}}
            refContext={props.refContext}
            onChange={function (next) {
              patchStep({ ...step, params: next })
            }}
          />

          <StepParamsJsonEditor
            key={props.selectedToken ?? '__none__'}
            step={step}
            isAdvancedOpen={isAdvancedOpen}
            onToggleAdvanced={function () {
              setIsAdvancedOpen(function (open) {
                return !open
              })
            }}
            onPatchParams={function (params) {
              patchStep({ ...step, params })
            }}
          />

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
              const retry = event.target.value === '' ? undefined : Number(event.target.value)
              patchStep({ ...step, retry })
            }}
          />
          <ConditionField
            label="when 条件"
            value={step.when}
            refContext={props.refContext}
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
          refContext={props.refContext}
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
}

export { StepPanel }
