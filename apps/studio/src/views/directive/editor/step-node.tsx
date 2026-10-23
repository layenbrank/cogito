import { Button } from '@cogito/design/components/button'
import { Card, CardContent } from '@cogito/design/components/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@cogito/design/components/collapsible'
import { Input } from '@cogito/design/components/input'
import { Popover, PopoverContent, PopoverTrigger } from '@cogito/design/components/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@cogito/design/components/tooltip'
import { cn } from 'cn'
import { memo, useState, type ReactNode } from 'react'

import { toast } from 'sonner'

import type { CorexAction } from '@/stores/corex'

import { findBucketMark } from '@/views/directive/list/bucket'
import { createDefaultValues, formatValue, setParamValue } from '@/views/directive/params/field'
import { ParamField } from '@/views/directive/params/param-field'
import {
  COMPARE_PLACEHOLDER,
  CONDITION_KINDS,
  CONDITION_LABELS,
  conditionKind,
  makeCondition,
  parseOperand,
  type CompareKind,
  type ConditionKind
} from './condition'
import { CONTROL_CLASS, Field, Glyph, HintTooltip, STEP_CARD_CLASS } from './controls'
import { OnErrorSelect } from './on-error'
import {
  CONTROL_KINDS,
  STEP_KINDS,
  buildControlStep,
  childStepsOf,
  nextStepId,
  nextToken,
  switchStepKind,
  type ControlKind,
  type StepKind
} from './step-utils'
import type { Condition, Step, StepsStep } from './types'

const STEP_KIND_LABEL = {
  action: '动作',
  if: '条件分支',
  repeat: '循环',
  parallel: '并行',
  steps: '顺序块'
} as const satisfies Record<StepKind, string>

/** 类型下拉与「添加步骤」的控制流一栏共用同一套图标，免得两处各挑一个 */
const STEP_KIND_ICONS: Record<StepKind, string> = {
  action: 'mdi:play-circle-outline',
  if: 'mdi:source-branch',
  repeat: 'mdi:repeat',
  parallel: 'mdi:call-split',
  steps: 'mdi:format-list-numbered'
}

/** 控制流步骤的色块：动作步骤用分类 tile，这里只管 if/repeat/… */
const STEP_KIND_TILES: Record<Exclude<StepKind, 'action'>, string> = {
  if: 'bg-chart-4/22 text-foreground',
  repeat: 'bg-primary/12 text-primary',
  parallel: 'bg-chart-1/15 text-chart-1',
  steps: 'bg-secondary text-secondary-foreground'
}

function findAction(catalog: CorexAction[], id: string | undefined): CorexAction | undefined {
  if (!id) return undefined
  return catalog.find(function (action) {
    return action.id === id
  })
}

/**
 * 逐步把步骤骨架拼出来。
 *
 * id 由调用方给：新增步骤时用 `nextStepId` 推一个不撞车的；换动作时沿用原 id ——
 * id 是用户可能改过的别名，换个动作不该顺带把它改掉。token 同样沿用，免得列表卸掉这张卡。
 */
function buildStep(action: CorexAction, id: string, token?: string): Step {
  const params = createDefaultValues(action.params)
  return {
    id,
    token: token ?? nextToken(),
    action: action.id,
    ...(Object.keys(params).length > 0 ? { params } : {})
  }
}

interface ParamFieldsProps {
  action: CorexAction | undefined
  params: Record<string, unknown> | undefined
  onChange: (name: string, value: unknown) => void
}

function ParamFields(props: ParamFieldsProps) {
  const defs = props.action?.params ?? []
  if (defs.length === 0) {
    return <p className="text-xs text-muted-foreground">该动作无可配置参数</p>
  }

  return (
    <div className="flex flex-col gap-2.5 border-t border-dashed pt-2.5">
      {defs.map(function (param) {
        return (
          <ParamField
            key={param.name}
            param={param}
            value={props.params?.[param.name]}
            onChange={function (value) {
              props.onChange(param.name, value)
            }}
          />
        )
      })}
    </div>
  )
}

interface KindSelectProps {
  kind: ConditionKind
  onChange: (kind: ConditionKind) => void
}

function KindSelect(props: KindSelectProps) {
  return (
    <Select
      items={CONDITION_LABELS}
      value={props.kind}
      onValueChange={function (value) {
        if (value === null) return
        props.onChange(value as ConditionKind)
      }}>
      <SelectTrigger
        size="sm"
        className="w-28 shrink-0 cursor-pointer"
        aria-label="条件类型">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CONDITION_KINDS.map(function (kind) {
          return (
            <SelectItem
              key={kind}
              value={kind}>
              {CONDITION_LABELS[kind]}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

interface ConditionNodeProps {
  condition: Condition
  onChange: (next: Condition) => void
}

function ConditionNode(props: ConditionNodeProps) {
  const condition = props.condition
  const isExpr = typeof condition === 'string'
  const kind: ConditionKind = isExpr ? 'expr' : conditionKind(condition)

  function onKindChange(next: ConditionKind) {
    if (next === kind) return
    props.onChange(makeCondition(next))
  }

  if (isExpr) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <KindSelect
            kind={kind}
            onChange={onKindChange}
          />
          <Input
            className={cn(CONTROL_CLASS, 'min-w-0 flex-1')}
            value={condition}
            placeholder="如 {{variables.enabled}}"
            onChange={function (event) {
              props.onChange(event.target.value)
            }}
          />
        </div>
      </div>
    )
  }

  if (kind === 'and' || kind === 'or') {
    const list = (kind === 'and' ? condition.and : condition.or) ?? []
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <KindSelect
            kind={kind}
            onChange={onKindChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={function () {
              props.onChange({ ...condition, [kind]: [...list, ''] })
            }}>
            <Glyph icon="mdi:plus" />
            子条件
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 border-l-2 border-dashed pl-2.5">
          {list.map(function (child, index) {
            return (
              <div
                key={index}
                className="flex items-start gap-1">
                <ConditionNode
                  condition={child}
                  onChange={function (next) {
                    props.onChange({
                      ...condition,
                      [kind]: list.map(function (item, i) {
                        return i === index ? next : item
                      })
                    })
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除子条件"
                  onClick={function () {
                    props.onChange({
                      ...condition,
                      [kind]: list.filter(function (_, i) {
                        return i !== index
                      })
                    })
                  }}>
                  <Glyph icon="mdi:close" />
                </Button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (kind === 'not') {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <KindSelect
          kind={kind}
          onChange={onKindChange}
        />
        <div className="border-l-2 border-dashed pl-2.5">
          <ConditionNode
            condition={condition.not ?? ''}
            onChange={function (next) {
              props.onChange({ not: next })
            }}
          />
        </div>
      </div>
    )
  }

  const key = kind as CompareKind
  const values = condition[key] ?? []
  const left = values[0]
  const right = values[1]
  const [leftHint, rightHint] = COMPARE_PLACEHOLDER[key]
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <KindSelect
        kind={kind}
        onChange={onKindChange}
      />
      <div className="flex gap-1.5">
        <Input
          className={CONTROL_CLASS}
          value={formatValue(left)}
          placeholder={leftHint}
          aria-label="左值"
          onChange={function (event) {
            props.onChange({ [key]: [parseOperand(event.target.value), right] })
          }}
        />
        <Input
          className={CONTROL_CLASS}
          value={formatValue(right)}
          placeholder={rightHint}
          aria-label="右值"
          onChange={function (event) {
            props.onChange({ [key]: [left, parseOperand(event.target.value)] })
          }}
        />
      </div>
    </div>
  )
}

/**
 * 切换步骤类型：换成动作要一份动作目录来填 `action`（取目录里的第一条，之后可在标题上换），
 * 其余四种按 step-utils 的规则原地重建 —— 保留 id 与还说得通的子步骤。
 */
function toKind(step: Step, kind: StepKind, catalog: CorexAction[]): Step {
  if (kind !== 'action') return switchStepKind(step, kind)
  if (childStepsOf(step).length > 0) {
    toast.error('换成动作会丢掉子步骤', { description: '先改成顺序块，或把子步骤挪走再换。' })
    return step
  }
  const action = catalog[0]
  // 目录空着时就没什么可选的动作，保持原样好过造一个空 action
  if (!action) return step
  // 顺序块的 id 是可选的：没写就现推一个 YAML 名；列表身份沿用原 token
  return buildStep(action, step.id ?? nextStepId(action.id, []), step.token)
}

interface AddStepButtonProps {
  catalog: CorexAction[]
  onPick: (action: CorexAction) => void
  /** 加一个控制流步骤：新增的指令要拿到 if / repeat / parallel / steps 只能走这里 */
  onAddKind: (kind: ControlKind) => void
}

function AddStepButton(props: AddStepButtonProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const keyword = query.trim().toLowerCase()
  const actions = keyword
    ? props.catalog.filter(function (action) {
        return (
          action.name.toLowerCase().includes(keyword) || action.id.toLowerCase().includes(keyword)
        )
      })
    : props.catalog
  const kinds = keyword
    ? CONTROL_KINDS.filter(function (kind) {
        return STEP_KIND_LABEL[kind].toLowerCase().includes(keyword) || kind.includes(keyword)
      })
    : CONTROL_KINDS

  function close() {
    setOpen(false)
    setQuery('')
  }

  function pick(action: CorexAction) {
    props.onPick(action)
    close()
  }

  function addKind(kind: ControlKind) {
    props.onAddKind(kind)
    close()
  }

  return (
    <Popover
      open={open}
      onOpenChange={function (next) {
        if (next) setOpen(true)
        else close()
      }}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-full cursor-pointer rounded-xl border-border/70 py-5 text-muted-foreground hover:text-foreground"
          />
        }>
        <Glyph icon="mdi:plus" />
        添加步骤
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 gap-0 p-0">
        <div className="flex items-center gap-2 border-b px-2.5">
          <Glyph
            icon="mdi:magnify"
            className="text-muted-foreground"
          />
          <Input
            autoFocus
            value={query}
            placeholder="搜索动作或控制流…"
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            onChange={function (event) {
              setQuery(event.target.value)
            }}
          />
        </div>
        {/*
          弹层里的长列表必须自带滚动容器：Radix 的 ScrollArea 视口是 `size-full`，
          父元素只有 max-height（高度不确定）时百分比高度退化成 auto，列表会直接溢出弹层。
        */}
        <div className="max-h-64 overflow-y-auto p-1.5">
          {actions.length > 0 ? (
            <>
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">动作</p>
              <ul className="flex flex-col gap-0.5">
                {actions.map(function (action) {
                  const mark = findBucketMark(action.bucket).icon
                  return (
                    <li key={action.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 font-normal"
                        onClick={function () {
                          pick(action)
                        }}>
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Glyph
                            icon={mark}
                            className="size-3.5"
                          />
                        </span>
                        <span className="truncate text-sm">{action.name}</span>
                        <code className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                          {action.id}
                        </code>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          {kinds.length > 0 ? (
            <>
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">控制流</p>
              <ul className="flex flex-col gap-0.5">
                {kinds.map(function (kind) {
                  return (
                    <li key={kind}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2.5 px-2 py-1.5 font-normal"
                        onClick={function () {
                          addKind(kind)
                        }}>
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Glyph
                            icon={STEP_KIND_ICONS[kind]}
                            className="size-3.5"
                          />
                        </span>
                        <span className="truncate text-sm">{STEP_KIND_LABEL[kind]}</span>
                        <code className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
                          {kind}
                        </code>
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
          {actions.length === 0 && kinds.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的步骤</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ChildStepsProps {
  steps: Step[]
  catalog: CorexAction[]
  onChange: (steps: Step[]) => void
  onStepChange: (next: Step) => void
  onRemove: (token: string) => void
  onDuplicate: (token: string) => void
  onMove: (token: string, delta: number) => void
  /** 给分支加一个「收进顺序块」：parallel 的分支只吃一个步骤，两步的分支得先包起来 */
  onWrap?: (index: number) => void
}

function ChildSteps(props: ChildStepsProps) {
  const wrap = props.onWrap

  return (
    <div className="flex flex-col gap-2 border-l-2 pl-3.5">
      {props.steps.map(function (child, index) {
        // 本身就是顺序块 / 循环的，再包一层只是白套
        const canWrap = wrap !== undefined && !('steps' in child)
        return (
          <StepNode
            key={child.token ?? `step-${index}`}
            step={child}
            catalog={props.catalog}
            index={index}
            count={props.steps.length}
            onChange={props.onStepChange}
            onRemove={props.onRemove}
            onDuplicate={props.onDuplicate}
            onMove={props.onMove}
            onWrapSteps={
              canWrap
                ? function () {
                    wrap(index)
                  }
                : undefined
            }
          />
        )
      })}
      <AddStepButton
        catalog={props.catalog}
        onPick={function (action) {
          props.onChange([...props.steps, buildStep(action, nextStepId(action.id, props.steps))])
        }}
        onAddKind={function (kind) {
          props.onChange([...props.steps, buildControlStep(kind, nextStepId(kind, props.steps))])
        }}
      />
    </div>
  )
}

interface IconActionProps {
  label: string
  icon: string
  onClick: () => void
  className?: string
}

/** 带 tooltip 的图标动作按钮（步骤头部一排操作共用） */
function IconAction(props: IconActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            className={cn('text-muted-foreground', props.className)}
            onClick={props.onClick}>
            <Glyph icon={props.icon} />
          </Button>
        }
      />
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  )
}

interface StepHeaderProps {
  icon: ReactNode
  /** 图标色块；动作步骤用分类色，控制流用类型色 */
  tileClass?: string
  /** 当前类型；下拉里可以直接换一种（就地重建，id 保留） */
  kind: StepKind
  id: string
  title: ReactNode
  onIdChange: (id: string) => void
  onKindChange: (kind: StepKind) => void
  onRemove: () => void
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onWrapSteps?: () => void
}

function StepHeader(props: StepHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 px-3">
      <span
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4',
          props.tileClass ?? 'bg-primary/10 text-primary'
        )}>
        {props.icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        {typeof props.title === 'string' ? (
          <span className="truncate text-sm font-semibold">{props.title}</span>
        ) : (
          props.title
        )}
        <Select
          items={STEP_KIND_LABEL}
          value={props.kind}
          onValueChange={function (value) {
            if (value === null) return
            props.onKindChange(value as StepKind)
          }}>
          <SelectTrigger
            size="sm"
            aria-label="切换步骤类型"
            className="h-5 w-fit cursor-pointer gap-1 border-transparent bg-secondary px-1.5 text-xs font-normal text-secondary-foreground shadow-none hover:bg-secondary/80 [&_svg]:size-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STEP_KINDS.map(function (kind) {
              return (
                <SelectItem
                  key={kind}
                  value={kind}>
                  {STEP_KIND_LABEL[kind]}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
      <Input
        className="ml-auto h-7 w-28 border-transparent bg-transparent text-right font-mono text-xs text-foreground/70 shadow-none hover:border-input hover:bg-background focus-visible:bg-background focus-visible:text-foreground"
        value={props.id}
        aria-label="步骤 id"
        onChange={function (event) {
          props.onIdChange(event.target.value)
        }}
      />
      <div className="flex shrink-0 items-center gap-0.5">
        {props.onWrapSteps ? (
          <IconAction
            label="收进顺序块"
            icon="mdi:format-list-numbered"
            onClick={props.onWrapSteps}
          />
        ) : null}
        {props.onMoveUp ? (
          <IconAction
            label="上移"
            icon="mdi:arrow-up"
            onClick={props.onMoveUp}
          />
        ) : null}
        {props.onMoveDown ? (
          <IconAction
            label="下移"
            icon="mdi:arrow-down"
            onClick={props.onMoveDown}
          />
        ) : null}
        {props.onDuplicate ? (
          <IconAction
            label="复制步骤"
            icon="mdi:content-copy"
            onClick={props.onDuplicate}
          />
        ) : null}
        <IconAction
          label="删除步骤"
          icon="mdi:trash-can-outline"
          className="hover:text-destructive"
          onClick={props.onRemove}
        />
      </div>
    </div>
  )
}

interface StepTreeOps {
  onChange: (next: Step) => void
  onRemove: (token: string) => void
  onDuplicate: (token: string) => void
  onMove: (token: string, delta: number) => void
}

interface StepOps {
  onDuplicate?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** 换一种步骤类型；StepNode 负责保留 id 与还说得通的子步骤 */
  onKindChange: (kind: StepKind) => void
  /** 把这一条收进顺序块（并行分支只吃一个步骤时用得着） */
  onWrapSteps?: () => void
  /** 整棵步骤树的 token 操作，子步骤列表直接沿用，避免按 index 闭包 */
  tree: StepTreeOps
}

interface ActionSelectProps {
  value: string
  catalog: CorexAction[]
  onChange: (action: CorexAction) => void
}

/** 步骤动作切换：换动作时按新动作的参数默认值重建 params，保留步骤 id */
function ActionSelect(props: ActionSelectProps) {
  return (
    <Select
      items={props.catalog.map(function (action) {
        return { value: action.id, label: action.name }
      })}
      value={props.value}
      onValueChange={function (id) {
        if (id === null) return
        const action = findAction(props.catalog, id)
        if (action) props.onChange(action)
      }}>
      <SelectTrigger
        size="sm"
        className="h-6 max-w-52 cursor-pointer border-transparent bg-transparent px-1 text-sm font-semibold shadow-none hover:bg-accent"
        aria-label="切换动作">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-72">
        {props.catalog.map(function (action) {
          return (
            <SelectItem
              key={action.id}
              value={action.id}>
              {action.name}
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

interface ActionStepCardProps extends StepOps {
  step: Extract<Step, { action: string }>
  catalog: CorexAction[]
  onChange: (next: Step) => void
  onRemove: () => void
}

function ActionStepCard(props: ActionStepCardProps) {
  const { step, catalog } = props
  const action = findAction(catalog, step.action)
  const mark = findBucketMark(action?.bucket)
  const [advanced, setAdvanced] = useState(Boolean(step.when !== undefined || step.save_to))

  return (
    <Card className={STEP_CARD_CLASS}>
      <StepHeader
        icon={
          <Glyph
            icon={mark.icon}
            className="size-4"
          />
        }
        tileClass={mark.tile}
        kind="action"
        onKindChange={props.onKindChange}
        onWrapSteps={props.onWrapSteps}
        id={step.id}
        title={
          <ActionSelect
            value={step.action}
            catalog={catalog}
            onChange={function (next) {
              props.onChange(buildStep(next, step.id, step.token))
            }}
          />
        }
        onIdChange={function (id) {
          props.onChange({ ...step, id })
        }}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
      />
      <CardContent className="flex flex-col gap-2.5 px-3">
        <code className="font-mono text-xs text-foreground/70">{step.action}</code>
        <ParamFields
          action={action}
          params={step.params}
          onChange={function (name, value) {
            props.onChange({ ...step, params: setParamValue(step.params ?? {}, name, value) })
          }}
        />
        <Collapsible
          open={advanced}
          onOpenChange={setAdvanced}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="w-fit px-1 text-foreground/70 hover:text-foreground">
                <Glyph
                  icon="mdi:chevron-right"
                  className={cn('transition-transform duration-200', advanced && 'rotate-90')}
                />
                高级选项（when / save_to / on_error / retry）
              </Button>
            }
          />
          <CollapsibleContent className="flex flex-col gap-2 border-t border-dashed pt-2">
            <Field label="when 条件">
              {step.when !== undefined ? (
                <ConditionNode
                  condition={step.when}
                  onChange={function (next) {
                    props.onChange({ ...step, when: next })
                  }}
                />
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={function () {
                    props.onChange({ ...step, when: '' })
                  }}>
                  <Glyph icon="mdi:plus" />
                  添加条件
                </Button>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="save_to">
                <Input
                  className={CONTROL_CLASS}
                  value={step.save_to ?? ''}
                  placeholder="变量名"
                  onChange={function (event) {
                    props.onChange({ ...step, save_to: event.target.value })
                  }}
                />
              </Field>
              <Field label="on_error">
                <OnErrorSelect
                  value={step.on_error ?? 'abort'}
                  onChange={function (next) {
                    props.onChange({ ...step, on_error: next })
                  }}
                />
              </Field>
              <Field label="retry">
                <Input
                  type="number"
                  className={CONTROL_CLASS}
                  value={step.retry ?? ''}
                  placeholder="0"
                  onChange={function (event) {
                    const raw = event.target.value
                    const next = { ...step }
                    if (raw === '') delete next.retry
                    else next.retry = Number(raw)
                    props.onChange(next)
                  }}
                />
              </Field>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

interface IfStepCardProps extends StepOps {
  step: Extract<Step, { if: Condition }>
  catalog: CorexAction[]
  onChange: (next: Step) => void
  onRemove: () => void
}

function IfStepCard(props: IfStepCardProps) {
  const { step, catalog } = props
  return (
    <Card className={STEP_CARD_CLASS}>
      <StepHeader
        icon={
          <Glyph
            icon="mdi:source-branch"
            className="size-4"
          />
        }
        tileClass={STEP_KIND_TILES.if}
        kind="if"
        onKindChange={props.onKindChange}
        onWrapSteps={props.onWrapSteps}
        id={step.id}
        title="条件分支"
        onIdChange={function (id) {
          props.onChange({ ...step, id })
        }}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
      />
      <CardContent className="flex flex-col gap-3 px-3">
        <div className="flex items-start gap-2">
          <span className="inline-flex items-center gap-1 pt-2 font-mono text-xs font-semibold text-foreground/70">
            <Glyph icon="mdi:help-rhombus-outline" />
            if
          </span>
          <ConditionNode
            condition={step.if}
            onChange={function (next) {
              props.onChange({ ...step, if: next })
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground/70">
            <Glyph icon="mdi:arrow-right-bottom" />
            then
          </span>
          <ChildSteps
            steps={step.then}
            catalog={catalog}
            onStepChange={props.tree.onChange}
            onRemove={props.tree.onRemove}
            onDuplicate={props.tree.onDuplicate}
            onMove={props.tree.onMove}
            onChange={function (next) {
              props.onChange({ ...step, then: next })
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-foreground/70">
            <Glyph icon="mdi:arrow-right-top" />
            else
          </span>
          <ChildSteps
            steps={step.else ?? []}
            catalog={catalog}
            onStepChange={props.tree.onChange}
            onRemove={props.tree.onRemove}
            onDuplicate={props.tree.onDuplicate}
            onMove={props.tree.onMove}
            onChange={function (next) {
              props.onChange({ ...step, else: next })
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

interface RepeatStepCardProps extends StepOps {
  step: Extract<Step, { repeat: object }>
  catalog: CorexAction[]
  onChange: (next: Step) => void
  onRemove: () => void
}

function RepeatStepCard(props: RepeatStepCardProps) {
  const { step, catalog } = props
  const hasEach = Boolean(step.repeat.each)
  const hasCount = step.repeat.count !== undefined
  return (
    <Card className={STEP_CARD_CLASS}>
      <StepHeader
        icon={
          <Glyph
            icon="mdi:repeat"
            className="size-4"
          />
        }
        tileClass={STEP_KIND_TILES.repeat}
        kind="repeat"
        onKindChange={props.onKindChange}
        onWrapSteps={props.onWrapSteps}
        id={step.id}
        title="循环"
        onIdChange={function (id) {
          props.onChange({ ...step, id })
        }}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
      />
      <CardContent className="flex flex-col gap-3 px-3">
        <div className="flex items-center gap-1.5 text-xs text-foreground/65">
          <span>each 与 count 二选一</span>
          <HintTooltip
            label="循环说明"
            hint="另一项将被忽略；as 绑当前元素（count 模式绑序号），index 绑序号。并发（> 1）时每个元素各拿一份上下文副本、元素之间互不可见；串行则共享同一份上下文。"
          />
        </div>
        <div className="@container">
          <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
            <Field
              label="each"
              hint="数组表达式，如 {{items}}">
              <Input
                className={CONTROL_CLASS}
                value={step.repeat.each ?? ''}
                placeholder="{{items}}"
                disabled={hasCount}
                onChange={function (event) {
                  props.onChange({ ...step, repeat: { ...step.repeat, each: event.target.value } })
                }}
              />
            </Field>
            <Field
              label="count"
              hint="固定次数；与 each 二选一">
              <Input
                type="number"
                className={CONTROL_CLASS}
                value={step.repeat.count ?? ''}
                placeholder="0"
                disabled={hasEach}
                onChange={function (event) {
                  const raw = event.target.value
                  const repeat = { ...step.repeat }
                  if (raw === '') delete repeat.count
                  else repeat.count = Number(raw)
                  props.onChange({ ...step, repeat })
                }}
              />
            </Field>
            <Field label="as">
              <Input
                className={CONTROL_CLASS}
                value={step.repeat.as ?? 'item'}
                onChange={function (event) {
                  props.onChange({ ...step, repeat: { ...step.repeat, as: event.target.value } })
                }}
              />
            </Field>
            <Field label="index">
              <Input
                className={CONTROL_CLASS}
                value={step.repeat.index ?? 'index'}
                onChange={function (event) {
                  props.onChange({ ...step, repeat: { ...step.repeat, index: event.target.value } })
                }}
              />
            </Field>
            <Field
              label="max_concurrency"
              hint="同时跑几个元素 / 几轮；1 = 串行"
              className="@min-[20rem]:col-span-2">
              <Input
                type="number"
                className={CONTROL_CLASS}
                value={step.max_concurrency ?? ''}
                placeholder="1（串行）"
                onChange={function (event) {
                  const raw = event.target.value
                  const next = { ...step }
                  if (raw === '') delete next.max_concurrency
                  else next.max_concurrency = Number(raw)
                  props.onChange(next)
                }}
              />
            </Field>
          </div>
        </div>
        <ChildSteps
          steps={step.steps}
          catalog={catalog}
          onStepChange={props.tree.onChange}
          onRemove={props.tree.onRemove}
          onDuplicate={props.tree.onDuplicate}
          onMove={props.tree.onMove}
          onChange={function (next) {
            props.onChange({ ...step, steps: next })
          }}
        />
      </CardContent>
    </Card>
  )
}

interface ParallelStepCardProps extends StepOps {
  step: Extract<Step, { parallel: Step[] }>
  catalog: CorexAction[]
  onChange: (next: Step) => void
  onRemove: () => void
}

function ParallelStepCard(props: ParallelStepCardProps) {
  const { step, catalog } = props
  return (
    <Card className={STEP_CARD_CLASS}>
      <StepHeader
        icon={
          <Glyph
            icon="mdi:call-split"
            className="size-4"
          />
        }
        tileClass={STEP_KIND_TILES.parallel}
        kind="parallel"
        onKindChange={props.onKindChange}
        onWrapSteps={props.onWrapSteps}
        id={step.id}
        title="并行"
        onIdChange={function (id) {
          props.onChange({ ...step, id })
        }}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
      />
      <CardContent className="flex flex-col gap-3 px-3">
        <Field
          label="max_concurrency"
          hint="最大并行数；默认 8">
          <Input
            type="number"
            className={CONTROL_CLASS}
            value={step.max_concurrency ?? ''}
            placeholder="默认 8"
            onChange={function (event) {
              const raw = event.target.value
              const next = { ...step }
              if (raw === '') delete next.max_concurrency
              else next.max_concurrency = Number(raw)
              props.onChange(next)
            }}
          />
        </Field>
        <ChildSteps
          steps={step.parallel}
          catalog={catalog}
          onStepChange={props.tree.onChange}
          onRemove={props.tree.onRemove}
          onDuplicate={props.tree.onDuplicate}
          onMove={props.tree.onMove}
          onChange={function (next) {
            props.onChange({ ...step, parallel: next })
          }}
          onWrap={function (index) {
            const next = [...step.parallel]
            const wrapped: Step = {
              id: nextStepId('steps', step.parallel),
              token: nextToken(),
              steps: [next[index]]
            }
            next[index] = wrapped
            props.onChange({ ...step, parallel: next })
          }}
        />
      </CardContent>
    </Card>
  )
}

interface StepsStepCardProps extends StepOps {
  step: StepsStep
  catalog: CorexAction[]
  onChange: (next: Step) => void
  onRemove: () => void
}

/** 顺序块：parallel 的分支只吃一个步骤，多步得先收进顺序块 */
function StepsStepCard(props: StepsStepCardProps) {
  const { step, catalog } = props
  return (
    <Card className={STEP_CARD_CLASS}>
      <StepHeader
        icon={
          <Glyph
            icon="mdi:format-list-numbered"
            className="size-4"
          />
        }
        tileClass={STEP_KIND_TILES.steps}
        kind="steps"
        onKindChange={props.onKindChange}
        onWrapSteps={props.onWrapSteps}
        id={step.id ?? ''}
        title="顺序块"
        onIdChange={function (id) {
          props.onChange({ ...step, id })
        }}
        onRemove={props.onRemove}
        onDuplicate={props.onDuplicate}
        onMoveUp={props.onMoveUp}
        onMoveDown={props.onMoveDown}
      />
      <CardContent className="flex flex-col gap-3 px-3">
        <ChildSteps
          steps={step.steps}
          catalog={catalog}
          onStepChange={props.tree.onChange}
          onRemove={props.tree.onRemove}
          onDuplicate={props.tree.onDuplicate}
          onMove={props.tree.onMove}
          onChange={function (next) {
            props.onChange({ ...step, steps: next })
          }}
        />
      </CardContent>
    </Card>
  )
}

interface StepNodeProps {
  step: Step
  catalog: CorexAction[]
  index: number
  count: number
  onChange: (next: Step) => void
  onRemove: (token: string) => void
  onDuplicate: (token: string) => void
  onMove: (token: string, delta: number) => void
  /** 只有并行分支会传：把这一条包进顺序块（一个分支只吃一个步骤） */
  onWrapSteps?: () => void
}

function StepNode(props: StepNodeProps) {
  const token = props.step.token
  const shared = {
    catalog: props.catalog,
    onChange: props.onChange,
    onRemove: function () {
      if (token) props.onRemove(token)
    },
    onKindChange: function (kind: StepKind) {
      const rebuilt = toKind(props.step, kind, props.catalog)
      if (rebuilt !== props.step) props.onChange(rebuilt)
    },
    tree: {
      onChange: props.onChange,
      onRemove: props.onRemove,
      onDuplicate: props.onDuplicate,
      onMove: props.onMove
    },
    ...(token
      ? {
          onDuplicate: function () {
            props.onDuplicate(token)
          }
        }
      : {}),
    ...(token && props.index > 0
      ? {
          onMoveUp: function () {
            props.onMove(token, -1)
          }
        }
      : {}),
    ...(token && props.index < props.count - 1
      ? {
          onMoveDown: function () {
            props.onMove(token, 1)
          }
        }
      : {}),
    ...(props.onWrapSteps ? { onWrapSteps: props.onWrapSteps } : {})
  }

  if ('action' in props.step) {
    return (
      <ActionStepCard
        {...shared}
        step={props.step}
      />
    )
  }
  if ('if' in props.step) {
    return (
      <IfStepCard
        {...shared}
        step={props.step}
      />
    )
  }
  if ('repeat' in props.step) {
    return (
      <RepeatStepCard
        {...shared}
        step={props.step}
      />
    )
  }
  if ('parallel' in props.step) {
    return (
      <ParallelStepCard
        {...shared}
        step={props.step}
      />
    )
  }
  return (
    <StepsStepCard
      {...shared}
      step={props.step}
    />
  )
}

export default memo(StepNode)
export { AddStepButton }
