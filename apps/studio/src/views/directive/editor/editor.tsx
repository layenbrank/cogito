import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@cogito/design/components/alert-dialog'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Checkbox } from '@cogito/design/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@cogito/design/components/dialog'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@cogito/design/components/resizable'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'
import { Spinner } from '@cogito/design/components/spinner'
import { Textarea } from '@cogito/design/components/textarea'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import { motion, useReducedMotion } from 'motion/react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Glide } from '@/components/glide/glide'
import { findModifierLabel } from '@/features/window/shortcuts'
import { isValidDirectiveName } from '@/shared/ipc/specs/sidecar'
import { useCorexStore, type CorexAction } from '@/stores/corex'

import { createDirective } from '@/views/directive/draft'
import { BUCKET_LABELS, BUCKETS, parseBucket } from '@/views/directive/list/bucket'
import { CARD_ENTER } from '@/views/directive/list/motion'
import { PERMISSION_ICONS, PERMISSION_KEYS, PERMISSION_LABELS } from '@/views/directive/permissions'
import { capsFromTriggers } from '@/views/directive/run/run-caps'
import { RunMenu } from '@/views/directive/run/run-menu'
import {
  findSplitterState,
  META_ID,
  META_MAX,
  META_MIN,
  META_SIZE,
  PANEL_GROUP_ID,
  STEPS_ID,
  STEPS_MIN,
  writeSplitterLayout
} from '@/views/directive/splitter'
import {
  CONTROL_CLASS,
  Field,
  Glyph,
  HintTooltip,
  ITEM_CARD_CLASS,
  ItemCardActionRow,
  Section,
  TEXTAREA_CLASS
} from './controls'
import InputsEditor from './inputs-editor'
import { OnErrorSelect } from './on-error'
import StepNode, { AddStepButton } from './step-node'
import {
  buildControlStep,
  duplicateStep,
  mergeTokens,
  moveByToken,
  nextStepId,
  nextToken,
  removeStep,
  replaceStep,
  sanitizeSteps,
  stampSteps
} from './step-utils'
import type { DirectiveContent, DirectivePermissions, DirectiveTrigger, Step } from './types'

/** 步骤卡进场：常量对象，避免每帧 new transition 让 motion 对账 */
const STEP_TRANSITION = { duration: 0.22, ease: 'easeOut' } as const
const STEP_TRANSITION_REDUCED = { duration: 0.1, ease: 'easeOut' } as const

/** Radix Select 不允许空字符串作为选项值 */
const UNCATEGORIZED = 'uncategorized'

/** 名字不合法的说法只有一处，输入框下的提示与保存时的拦截共用 */
const NAME_RULE_HINT = '名字不能为空，也不能带 / \\ 或 ..'

/** corex watch 触发器支持的文件事件 */
const WATCH_EVENTS = ['create', 'modify', 'remove', 'access'] as const

/** watch 的防抖/节流触发时机；`默认` = 不写这个键，交给 corex（防抖 trailing、节流 both） */
const EDGE_OPTIONS = ['default', 'leading', 'trailing', 'both'] as const

type EdgeOption = (typeof EDGE_OPTIONS)[number]

const EDGE_LABELS: Record<EdgeOption, string> = {
  default: '默认',
  leading: '前沿',
  trailing: '尾随',
  both: '两者'
}

/** watch 的两个布尔开关，不写就是关 */
const WATCH_FLAGS = [
  { name: 'poll', hint: '轮询检测，文件系统事件不可靠时用' },
  { name: 'immediate', hint: '启动时先对已有文件跑一次' }
] as const

/** `default` 表示不写这个键，让 corex 用它自己的默认时机 */
function toEdge(option: EdgeOption) {
  return option === 'default' ? undefined : option
}

/** 把输入表单的字符串还原为接近 YAML 默认值类型的值 */
function coerceInput(raw: string, def: unknown): unknown {
  if (typeof def === 'boolean') {
    return raw === 'true' || raw === '1' || raw === 'on'
  }
  if (typeof def === 'number') {
    const num = Number(raw)
    return Number.isNaN(num) ? raw : num
  }
  return raw
}

function linesToText(lines: string[] | undefined): string {
  return (lines ?? []).join('\n')
}

/**
 * 编辑态拆行：保留空行，否则按 Enter 会被立刻滤掉、看起来「无法换行」。
 * 空白 / 空行在落库前再清（见 `cleanGlobLines`）。
 */
function textToDraftLines(text: string): string[] {
  return text.split('\n')
}

/** 落库前：trim 后丢掉空行，避免无效 glob 写进指令 */
function cleanGlobLines(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map(function (line) {
      return line.trim()
    })
    .filter(Boolean)
}

function sanitizeWatchGlobs(lines: string[] | undefined): string[] | undefined {
  if (lines === undefined) return undefined
  const cleaned = cleanGlobLines(lines)
  return cleaned.length > 0 ? cleaned : undefined
}

function sanitizeTriggers(
  triggers: DirectiveTrigger[] | undefined
): DirectiveTrigger[] | undefined {
  if (!triggers || triggers.length === 0) return triggers
  return triggers.map(function (trigger) {
    if (trigger.type !== 'watch') return trigger
    return {
      ...trigger,
      paths: cleanGlobLines(trigger.paths),
      includes: sanitizeWatchGlobs(trigger.includes),
      excludes: sanitizeWatchGlobs(trigger.excludes)
    }
  })
}

interface VariableValueProps {
  value: unknown
  onChange: (value: unknown) => void
}

function VariableValue(props: VariableValueProps) {
  const value = props.value

  if (typeof value === 'boolean') {
    return (
      <label className="inline-flex h-8 w-full items-center gap-1.5 rounded-lg border border-border/70 bg-background px-2.5 text-xs text-foreground">
        <Checkbox
          checked={value}
          aria-label="变量值"
          onCheckedChange={function (checked) {
            props.onChange(checked === true)
          }}
        />
        {value ? 'true' : 'false'}
      </label>
    )
  }

  if (typeof value === 'number') {
    return (
      <Input
        type="number"
        className={CONTROL_CLASS}
        value={value}
        aria-label="变量值"
        onChange={function (event) {
          props.onChange(Number(event.target.value))
        }}
      />
    )
  }

  const text =
    typeof value === 'string'
      ? value
      : value === undefined || value === null
        ? ''
        : JSON.stringify(value)
  return (
    <Input
      type="text"
      className={CONTROL_CLASS}
      value={text}
      aria-label="变量值"
      onChange={function (event) {
        props.onChange(event.target.value)
      }}
    />
  )
}

interface VariablesEditorProps {
  variables: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

/**
 * 变量行。
 *
 * key 用位置而不是变量名：行只能追加和删除（顺序由变量表自己定，界面不提供排序），
 * 位置在一行活着的时候不变；换成变量名当 key 的话，改一个字整行就被 React 重挂，
 * 输入框当场丢焦点，只能一个字一个字地改。
 */
function VariablesEditor(props: VariablesEditorProps) {
  const entries = Object.entries(props.variables)

  return (
    <div className="flex flex-col gap-2">
      {entries.map(function (entry, index) {
        const key = entry[0]
        return (
          <div
            key={index}
            className={ITEM_CARD_CLASS}>
            <ItemCardActionRow>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除变量"
                title="删除变量"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={function () {
                  const next = { ...props.variables }
                  delete next[key]
                  props.onChange(next)
                }}>
                <Glyph icon="mdi:trash-can-outline" />
              </Button>
            </ItemCardActionRow>
            <Field label="变量名">
              <Input
                className={cn(CONTROL_CLASS, 'font-mono')}
                value={key}
                aria-label="变量名"
                placeholder="如 base"
                onChange={function (event) {
                  const next: Record<string, unknown> = {}
                  Object.entries(props.variables).forEach(function (item) {
                    next[item[0] === key ? event.target.value : item[0]] = item[1]
                  })
                  props.onChange(next)
                }}
              />
            </Field>
            <Field label="值">
              <VariableValue
                value={entry[1]}
                onChange={function (next) {
                  props.onChange({ ...props.variables, [key]: next })
                }}
              />
            </Field>
          </div>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full cursor-pointer rounded-lg"
        onClick={function () {
          props.onChange({ ...props.variables, [`var${entries.length + 1}`]: '' })
        }}>
        <Glyph icon="mdi:plus" />
        添加变量
      </Button>
    </div>
  )
}

interface PermissionsEditorProps {
  permissions: DirectivePermissions
  onChange: (next: DirectivePermissions) => void
}

function PermissionsEditor(props: PermissionsEditorProps) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-1.5 @min-[16rem]:grid-cols-2">
        {PERMISSION_KEYS.map(function (key) {
          const isOn = Boolean(props.permissions[key])
          return (
            <div
              key={key}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-xs transition-colors',
                isOn
                  ? 'border-primary/40 bg-primary/5 text-foreground'
                  : 'border-border/70 bg-background text-foreground hover:bg-accent'
              )}
              onClick={function () {
                props.onChange({ ...props.permissions, [key]: !isOn })
              }}>
              <Checkbox
                checked={isOn}
                onClick={function (event) {
                  event.stopPropagation()
                }}
                onCheckedChange={function (checked) {
                  props.onChange({ ...props.permissions, [key]: checked === true })
                }}
              />
              <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-normal">
                <Glyph icon={PERMISSION_ICONS[key]} />
                {PERMISSION_LABELS[key]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface TriggersEditorProps {
  triggers: DirectiveTrigger[]
  onChange: (next: DirectiveTrigger[]) => void
}

interface EdgeSelectProps {
  label: string
  hint?: string
  value: EdgeOption
  onChange: (next: EdgeOption) => void
}

/** 防抖/节流的触发时机（corex `Edge`） */
function EdgeSelect(props: EdgeSelectProps) {
  return (
    <Field
      label={props.label}
      hint={props.hint}>
      <Select
        items={EDGE_LABELS}
        value={props.value}
        onValueChange={function (value) {
          if (value === null) return
          props.onChange(value as EdgeOption)
        }}>
        <SelectTrigger
          size="sm"
          className="w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EDGE_OPTIONS.map(function (option) {
            return (
              <SelectItem
                key={option}
                value={option}>
                {EDGE_LABELS[option]}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </Field>
  )
}

function TriggersEditor(props: TriggersEditorProps) {
  const hasCron = props.triggers.some(function (trigger) {
    return trigger.type === 'cron'
  })
  const hasWatch = props.triggers.some(function (trigger) {
    return trigger.type === 'watch'
  })

  function patch(index: number, next: DirectiveTrigger) {
    props.onChange(
      props.triggers.map(function (trigger, i) {
        return i === index ? next : trigger
      })
    )
  }

  function remove(index: number) {
    props.onChange(
      props.triggers.filter(function (_, i) {
        return i !== index
      })
    )
  }

  /** cron / watch 可并存，同类型只允许一条 */
  function addTrigger(kind: 'cron' | 'watch') {
    if (kind === 'cron') {
      if (hasCron) return
      props.onChange([...props.triggers, { type: 'cron', expr: '' }])
      return
    }
    if (hasWatch) return
    props.onChange([...props.triggers, { type: 'watch', paths: [] }])
  }

  return (
    <div className="@container flex flex-col gap-2">
      {props.triggers.map(function (trigger, index) {
        return (
          <div
            key={index}
            className={ITEM_CARD_CLASS}>
            <ItemCardActionRow
              leading={
                <Badge
                  variant="secondary"
                  className="gap-1 rounded-md">
                  <Glyph icon={trigger.type === 'cron' ? 'mdi:clock-outline' : 'mdi:eye-outline'} />
                  {trigger.type}
                </Badge>
              }>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="删除触发器"
                title="删除触发器"
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={function () {
                  remove(index)
                }}>
                <Glyph icon="mdi:trash-can-outline" />
              </Button>
            </ItemCardActionRow>
            {trigger.type === 'cron' ? (
              <div className="flex flex-col gap-2">
                <Field
                  label="expr"
                  hint="cron 表达式，如 0 9 * * 1-5">
                  <Input
                    className={cn(CONTROL_CLASS, 'font-mono')}
                    value={trigger.expr}
                    placeholder="0 9 * * 1-5"
                    onChange={function (event) {
                      patch(index, { ...trigger, expr: event.target.value })
                    }}
                  />
                </Field>
                <Field
                  label="timezone"
                  hint="local、utc 或 ±HH:MM">
                  <Input
                    className={CONTROL_CLASS}
                    value={trigger.timezone ?? ''}
                    placeholder="local"
                    onChange={function (event) {
                      patch(index, { ...trigger, timezone: event.target.value })
                    }}
                  />
                </Field>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Field
                  label="paths"
                  hint="每行一个路径；可用 {{变量}}">
                  <Textarea
                    className={cn(TEXTAREA_CLASS, 'font-mono')}
                    value={linesToText(trigger.paths)}
                    onChange={function (event) {
                      patch(index, { ...trigger, paths: textToDraftLines(event.target.value) })
                    }}
                  />
                </Field>
                <Field
                  label="events"
                  hint="监听哪些文件事件">
                  <ToggleGroup
                    multiple
                    size="sm"
                    variant="outline"
                    spacing={0}
                    value={trigger.events ?? []}
                    onValueChange={function (value) {
                      patch(index, {
                        ...trigger,
                        events: WATCH_EVENTS.filter(function (name) {
                          return value.includes(name)
                        })
                      })
                    }}
                    className="grid w-full grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] grid-flow-row-dense gap-1.5">
                    {WATCH_EVENTS.map(function (name) {
                      return (
                        <ToggleGroupItem
                          key={name}
                          value={name}
                          className={cn(
                            'h-7 justify-center rounded-md px-2.5 text-xs',
                            // 各自完整圆角与边框，覆盖 spacing=0 的紧凑连排样式
                            'data-[spacing=0]:rounded-md data-[spacing=0]:first:rounded-md data-[spacing=0]:last:rounded-md',
                            'data-[spacing=0]:data-[variant=outline]:border-l data-pressed:shadow-none'
                          )}>
                          {name}
                        </ToggleGroupItem>
                      )
                    })}
                  </ToggleGroup>
                </Field>
                <Field
                  label="includes"
                  hint="每行一个 glob；空 = 全部纳入">
                  <Textarea
                    className={cn(TEXTAREA_CLASS, 'font-mono')}
                    value={linesToText(trigger.includes)}
                    onChange={function (event) {
                      patch(index, { ...trigger, includes: textToDraftLines(event.target.value) })
                    }}
                  />
                </Field>
                <Field
                  label="excludes"
                  hint="每行一个 glob；优先于 includes">
                  <Textarea
                    className={cn(TEXTAREA_CLASS, 'font-mono')}
                    value={linesToText(trigger.excludes)}
                    onChange={function (event) {
                      patch(index, { ...trigger, excludes: textToDraftLines(event.target.value) })
                    }}
                  />
                </Field>
                <div className="@container">
                  <div className="grid grid-cols-1 gap-2 @min-[20rem]:grid-cols-2">
                    <EdgeSelect
                      label="debounce"
                      hint="默认 trailing；不写则交给 corex"
                      value={trigger.debounce ?? 'default'}
                      onChange={function (next) {
                        patch(index, { ...trigger, debounce: toEdge(next) })
                      }}
                    />
                    <Field label="debounce_ms">
                      <Input
                        type="number"
                        step={100}
                        min={0}
                        className={CONTROL_CLASS}
                        value={trigger.debounce_ms ?? ''}
                        onChange={function (event) {
                          const raw = event.target.value
                          const next = { ...trigger }
                          if (raw === '') delete next.debounce_ms
                          else next.debounce_ms = Number(raw)
                          patch(index, next)
                        }}
                      />
                    </Field>
                    <EdgeSelect
                      label="throttle"
                      hint="默认 both；不写则交给 corex"
                      value={trigger.throttle ?? 'default'}
                      onChange={function (next) {
                        patch(index, { ...trigger, throttle: toEdge(next) })
                      }}
                    />
                    <Field
                      label="throttle_ms"
                      hint="必须大于 0；步进 100ms">
                      <Input
                        type="number"
                        step={100}
                        min={100}
                        className={CONTROL_CLASS}
                        value={trigger.throttle_ms ?? ''}
                        onChange={function (event) {
                          const raw = event.target.value
                          const next = { ...trigger }
                          if (raw === '') delete next.throttle_ms
                          else next.throttle_ms = Number(raw)
                          patch(index, next)
                        }}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 @min-[20rem]:col-span-2">
                      {WATCH_FLAGS.map(function (flag) {
                        const id = `trigger-${flag.name}-${index}`
                        return (
                          <div
                            key={flag.name}
                            className="flex items-center gap-1.5">
                            <Checkbox
                              id={id}
                              checked={Boolean(trigger[flag.name])}
                              onCheckedChange={function (checked) {
                                patch(index, { ...trigger, [flag.name]: checked === true })
                              }}
                            />
                            <Label
                              htmlFor={id}
                              className="font-mono text-xs font-normal">
                              {flag.name}
                            </Label>
                            <HintTooltip
                              hint={flag.hint}
                              label={`${flag.name} 说明`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div className="grid grid-cols-1 gap-1.5 @min-[16rem]:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer rounded-lg"
          disabled={hasCron}
          title={hasCron ? '已有 cron，不可重复添加' : '添加 cron 定时触发'}
          onClick={function () {
            addTrigger('cron')
          }}>
          <Glyph icon="mdi:clock-outline" />
          {hasCron ? '已有 cron' : '添加 cron'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 cursor-pointer rounded-lg"
          disabled={hasWatch}
          title={hasWatch ? '已有 watch，不可重复添加' : '添加 watch 观察触发'}
          onClick={function () {
            addTrigger('watch')
          }}>
          <Glyph icon="mdi:eye-outline" />
          {hasWatch ? '已有 watch' : '添加 watch'}
        </Button>
      </div>
    </div>
  )
}

/** 输入初值：YAML 里写了 default 就用它，没写留空 */
function initialInputs(content: DirectiveContent): Record<string, string> {
  const values: Record<string, string> = {}
  content.inputs.forEach(function (input) {
    values[input.name] = input.default !== undefined ? String(input.default) : ''
  })
  return values
}

/** 输入声明改名/删除时，把「本次运行」的值跟着搬或丢掉 */
function relocateInputValues(
  previous: DirectiveContent['inputs'],
  next: DirectiveContent['inputs'],
  values: Record<string, string>
): Record<string, string> {
  const relocated = { ...values }
  previous.forEach(function (input, index) {
    const renamed = next[index]
    if (!renamed || renamed.name === input.name) return
    if (Object.prototype.hasOwnProperty.call(relocated, input.name)) {
      relocated[renamed.name] = relocated[input.name]
      delete relocated[input.name]
    }
  })
  const kept = new Set(
    next.map(function (input) {
      return input.name
    })
  )
  Object.keys(relocated).forEach(function (name) {
    if (!kept.has(name)) delete relocated[name]
  })
  return relocated
}

interface Props {
  /** 要打开的指令；空串表示还没选过，退回列表第一条 */
  name: string
  /** 列表收起后标题栏仍留一个按钮，否则没法把列表叫回来 */
  isListOpen: boolean
  onOpen: (name: string) => void
  onToggleList: () => void
  onRun: (name: string, input: Record<string, unknown>) => void
}

/**
 * 指令编辑器：上元数据/输入/变量/权限/触发器，下步骤树（递归控制流）。
 * 草稿按指令名分桶，来回切换不丢未保存的改动；运行交给下方运行台。
 */
function Editor({ name, isListOpen, onOpen, onToggleList, onRun }: Props) {
  const catalog = useCorexStore(function (state) {
    return state.catalog
  })
  const directives = useCorexStore(function (state) {
    return state.directives
  })

  const [drafts, setDrafts] = useState<Record<string, DirectiveContent>>({})
  /** 按指令名记脏：在 updateContent 置位，读盘/保存时清掉，避免每帧 JSON.stringify */
  const [dirty, updateDirty] = useState<Record<string, boolean>>({})
  /** corex 序列化出来的 YAML：只读对账用，改它不会生效 */
  const [yamls, setYamls] = useState<Record<string, string>>({})
  const [inputValues, setInputValues] = useState<Record<string, Record<string, string>>>({})
  /** 按指令名记错误：切走再切回来还看得到当初为什么没跑起来 */
  const [errors, setErrors] = useState<Record<string, string | null>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isYamlOpen, setIsYamlOpen] = useState(false)
  const [defaultLayout] = useState(findSplitterState)
  /** 快捷键提示里的修饰键：macOS 是 ⌘，其余是 Ctrl */
  const modifier = findModifierLabel()
  const isReducedMotion = useReducedMotion()

  /** 读过的指令不再重读，否则切回去会把没保存的草稿冲掉 */
  const loadedRef = useRef(new Set<string>())

  const activeName = name || (directives[0]?.name ?? '')
  /** 目录里还没有这个名字 = 刚点「新增」的指令：骨架先在本地支着，保存后才落到磁盘 */
  const isPending =
    activeName !== '' &&
    !directives.some(function (entry) {
      return entry.name === activeName
    })
  const content = drafts[activeName] ?? (isPending ? createDirective(activeName) : null)
  const values = inputValues[activeName] ?? {}
  const error = errors[activeName] ?? null
  const isDirty = content !== null && (dirty[activeName] ?? isPending)
  /** 名字不合法就别保存：corex 会拒，界面得先把话说在前面（提示在名字输入框下） */
  const nameError = content && !isValidDirectiveName(content.name) ? NAME_RULE_HINT : null

  useEffect(
    function () {
      if (!activeName || isPending || loadedRef.current.has(activeName)) return
      loadedRef.current.add(activeName)
      void useCorexStore
        .getState()
        .loadDirective(activeName)
        .then(function (document) {
          const loaded = document.definition
          const stamped = { ...loaded, steps: stampSteps(loaded.steps) }
          updateDirty(function (prev) {
            return { ...prev, [loaded.name]: false }
          })
          setYamls(function (prev) {
            return { ...prev, [loaded.name]: document.yaml }
          })
          setDrafts(function (prev) {
            return { ...prev, [loaded.name]: stamped }
          })
          setInputValues(function (prev) {
            return { ...prev, [loaded.name]: initialInputs(loaded) }
          })
          reportError(loaded.name, null)
        })
        .catch(function (err) {
          // 失败别占坑，切回来时还能再试一次
          loadedRef.current.delete(activeName)
          console.error('[directive] 读取指令失败', err)
          reportError(activeName, err instanceof Error ? err.message : String(err))
        })
    },
    [activeName, isPending]
  )

  function reportError(name: string, message: string | null) {
    setErrors(function (prev) {
      return { ...prev, [name]: message }
    })
  }

  /** 选中项 / 待建标记都是渲染期变量，用 useCallback 锁住后再给下游回调当依赖 */
  const updateContent = useCallback(
    function (update: (prev: DirectiveContent) => DirectiveContent) {
      setDrafts(function (prev) {
        // 新指令的第一次编辑还没有草稿可改，得先把骨架补进去，不然这一下编辑会被丢掉
        const current = prev[activeName] ?? (isPending ? createDirective(activeName) : null)
        if (!current) return prev
        const next = update(current)
        if (next === current) return prev
        updateDirty(function (flags) {
          if (flags[activeName]) return flags
          return { ...flags, [activeName]: true }
        })
        return { ...prev, [activeName]: next }
      })
    },
    [activeName, isPending]
  )

  function patchContent(patch: Partial<DirectiveContent>) {
    updateContent(function (prev) {
      return { ...prev, ...patch }
    })
  }

  const onStepChange = useCallback(
    function (next: Step) {
      const token = next.token
      if (!token) return
      updateContent(function (prev) {
        return { ...prev, steps: replaceStep(prev.steps, token, next) }
      })
    },
    [updateContent]
  )

  const onStepRemove = useCallback(
    function (token: string) {
      updateContent(function (prev) {
        return { ...prev, steps: removeStep(prev.steps, token) }
      })
    },
    [updateContent]
  )

  const onStepDuplicate = useCallback(
    function (token: string) {
      updateContent(function (prev) {
        return { ...prev, steps: duplicateStep(prev.steps, token) }
      })
    },
    [updateContent]
  )

  const onStepMove = useCallback(
    function (token: string, delta: number) {
      updateContent(function (prev) {
        return { ...prev, steps: moveByToken(prev.steps, token, delta) }
      })
    },
    [updateContent]
  )

  function setInput(name: string, value: string) {
    setInputValues(function (prev) {
      return { ...prev, [activeName]: { ...prev[activeName], [name]: value } }
    })
  }

  async function save(): Promise<string | null> {
    if (!content) return null
    if (nameError) {
      reportError(activeName, nameError)
      toast.error('不能保存', { description: nameError })
      return null
    }
    const saving = activeName
    // 原名与草稿里的名字不同 = 改名：把原名一起交给 daemon，它会原子地换掉那一行
    const originalName = saving && content.name !== saving ? saving : undefined
    setIsSaving(true)
    try {
      const document = await useCorexStore.getState().saveDirective(
        {
          ...content,
          triggers: sanitizeTriggers(content.triggers),
          steps: sanitizeSteps(content.steps)
        },
        originalName
      )
      updateDirty(function (prev) {
        const next = { ...prev, [document.name]: false }
        if (document.name !== saving) delete next[saving]
        return next
      })
      setYamls(function (prev) {
        const next = { ...prev, [document.name]: document.yaml }
        if (document.name !== saving) delete next[saving]
        return next
      })
      loadedRef.current.add(document.name)
      setDrafts(function (prev) {
        const prior = prev[saving]?.steps ?? content.steps
        const next = {
          ...prev,
          [document.name]: {
            ...document.definition,
            steps: mergeTokens(prior, document.definition.steps)
          }
        }
        if (document.name !== saving) delete next[saving]
        return next
      })
      if (document.name !== saving) {
        // 名字变了（用户改名，或 corex 规范化了它）：草稿、运行参数与已读标记一起搬过去，
        // 旧名字的缓存留着只会挡住下一条指令的加载
        setInputValues(function (prev) {
          const next = { ...prev, [document.name]: prev[saving] ?? {} }
          delete next[saving]
          return next
        })
        loadedRef.current.delete(saving)
        onOpen(document.name)
      }
      await useCorexStore.getState().refreshDirectives()
      return document.name
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportError(saving, message)
      toast.error('保存失败', { description: message })
      return null
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * 删掉这条指令。corex 那边删掉就没了，所以先问一次；
   * 删完把本地缓存一并清掉（草稿、已读标记、YAML），免得下一条指令被旧名字的状态挡住。
   */
  async function remove() {
    const target = activeName
    setIsDeleting(true)
    try {
      await useCorexStore.getState().deleteDirective(target)
      setDrafts(function (prev) {
        const next = { ...prev }
        delete next[target]
        return next
      })
      updateDirty(function (prev) {
        const next = { ...prev }
        delete next[target]
        return next
      })
      setYamls(function (prev) {
        const next = { ...prev }
        delete next[target]
        return next
      })
      setInputValues(function (prev) {
        const next = { ...prev }
        delete next[target]
        return next
      })
      loadedRef.current.delete(target)
      await useCorexStore.getState().refreshDirectives()
      const next = useCorexStore.getState().directives.find(function (entry) {
        return entry.name !== target
      })
      toast.success(`已删除指令 ${target}`)
      onOpen(next?.name ?? '')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportError(target, message)
      toast.error('删除失败', { description: message })
    } finally {
      setIsDeleting(false)
    }
  }

  /** 交给 corex 自己开外部编辑器（`corex edit <name>`）：它认得自己那份指令库 */
  async function openInEditor() {
    try {
      await itc.sidecar.editDirective({ name: activeName })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error('没能打开外部编辑器', { description: message })
    }
  }

  async function run() {
    if (!content) return

    const missing = content.inputs
      .filter(function (input) {
        return Boolean(input.required) && !(values[input.name] ?? '').trim()
      })
      .map(function (input) {
        return input.name
      })
    if (missing.length > 0) {
      const message = `缺少必填输入: ${missing.join(', ')}`
      reportError(activeName, message)
      toast.error('无法运行', { description: message })
      return
    }

    const input: Record<string, unknown> = {}
    content.inputs.forEach(function (item) {
      const raw = values[item.name] ?? ''
      input[item.name] = raw === '' ? (item.default ?? '') : coerceInput(raw, item.default)
    })

    // 运行前先落盘：corex 跑的是磁盘上那份 YAML
    const target = isDirty ? await save() : activeName
    if (target) onRun(target, input)
  }

  const actionsRef = useRef({ save, run })

  useEffect(function () {
    actionsRef.current = { save, run }
  })

  useEffect(function () {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key === 's') {
        event.preventDefault()
        void actionsRef.current.save()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        void actionsRef.current.run()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return function () {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const header = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur-md">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="cursor-pointer"
        title={isListOpen ? '收起指令列表' : '展开指令列表'}
        aria-label={isListOpen ? '收起指令列表' : '展开指令列表'}
        onClick={onToggleList}>
        <Glyph icon={isListOpen ? 'mdi:chevron-double-left' : 'mdi:chevron-double-right'} />
      </Button>
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Glyph icon="mdi:file-document-outline" />
      </span>
      <span className="truncate text-sm font-semibold tracking-tight">
        {activeName || '未选择指令'}
      </span>
      {isDirty ? (
        <Badge
          variant="outline"
          className="shrink-0 rounded-full border-primary/30 bg-primary/5 text-xs text-primary">
          未保存
        </Badge>
      ) : null}
      {content ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {content.steps.length} 步 · {content.inputs.length} 输入
        </span>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="cursor-pointer text-muted-foreground"
          aria-label="查看 YAML"
          title="查看 corex 落库的那份 YAML（只读）"
          disabled={!content || isPending}
          onClick={function () {
            setIsYamlOpen(true)
          }}>
          <Glyph icon="mdi:code-json" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="cursor-pointer text-muted-foreground"
          aria-label="用外部编辑器打开"
          title="用外部编辑器打开（corex edit）"
          disabled={!content || isDirty || isPending}
          onClick={function () {
            void openInEditor()
          }}>
          <Glyph icon="mdi:pencil-outline" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                aria-label="删除指令"
                title="删除指令"
                disabled={!content || isPending || isDeleting}
              />
            }>
            <Glyph icon="mdi:trash-can-outline" />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除「{activeName}」？</AlertDialogTitle>
              <AlertDialogDescription>
                指令库里这一条会被删掉，删掉后无法从 Studio 恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={function () {
                  void remove()
                }}>
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer rounded-full"
          title={`保存（${modifier} + S）`}
          disabled={!content || !isDirty || isSaving || nameError !== null}
          onClick={function () {
            void save()
          }}>
          {isSaving ? (
            <Spinner aria-label="保存中" />
          ) : (
            <Glyph icon="mdi:content-save-outline" />
          )}
          保存
        </Button>
        <RunMenu
          name={activeName}
          caps={capsFromTriggers(content?.triggers)}
          disabled={!content}
          onceTitle={`运行（${modifier} + Enter）`}
          onOnce={function () {
            void run()
          }}
          beforeGuard={async function () {
            if (!content) return null
            const target = isDirty ? await save() : activeName
            return target
          }}
        />
      </div>
    </header>
  )

  if (!content) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col bg-muted/35 text-foreground">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-card shadow-xs">
            <Glyph
              icon="mdi:file-document-outline"
              className="size-6 opacity-70"
            />
          </span>
          <p>{error ?? (activeName ? '读取中…' : '先在左侧选择一条指令')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-muted/35 text-foreground">
      {header}

      <ResizablePanelGroup
        id={PANEL_GROUP_ID}
        orientation="horizontal"
        className="min-h-0 w-full min-w-0"
        style={{ height: 'auto', flex: '1 1 0', minHeight: 0 }}
        defaultLayout={defaultLayout.layouts[PANEL_GROUP_ID]}
        onLayoutChanged={function (layout) {
          writeSplitterLayout(PANEL_GROUP_ID, layout)
        }}>
        <ResizablePanel
          id={META_ID}
          defaultSize={META_SIZE}
          minSize={META_MIN}
          maxSize={META_MAX}
          groupResizeBehavior="preserve-pixel-size"
          className="h-full min-h-0 min-w-0">
          <Glide.Y>
            <aside className="@container/meta flex flex-col gap-2.5 p-3">
              <Section
                icon={<Glyph icon="mdi:information-outline" />}
                tileClass="bg-primary/12 text-primary"
                title="基本信息">
                <Field label="名称">
                  <Input
                    className={CONTROL_CLASS}
                    value={content.name}
                    aria-invalid={nameError !== null}
                    onChange={function (event) {
                      patchContent({ name: event.target.value })
                    }}
                  />
                </Field>
                {nameError ? (
                  <p className="flex items-center gap-1 text-xs text-destructive">
                    <Glyph icon="mdi:alert-circle-outline" />
                    {nameError}
                  </p>
                ) : null}
                <Field label="描述">
                  <Textarea
                    className={TEXTAREA_CLASS}
                    value={content.description}
                    onChange={function (event) {
                      patchContent({ description: event.target.value })
                    }}
                  />
                </Field>
                <div className="@container">
                  <div className="grid grid-cols-1 gap-2 @min-[16rem]:grid-cols-2">
                    <Field label="版本">
                      <Input
                        className={CONTROL_CLASS}
                        value={content.version}
                        onChange={function (event) {
                          patchContent({ version: event.target.value })
                        }}
                      />
                    </Field>
                    <Field label="分类">
                      <Select
                        items={{ [UNCATEGORIZED]: '未分类', ...BUCKET_LABELS }}
                        value={content.bucket || UNCATEGORIZED}
                        onValueChange={function (value) {
                          if (value === null) return
                          patchContent({ bucket: parseBucket(value) })
                        }}>
                        <SelectTrigger
                          size="sm"
                          className="w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNCATEGORIZED}>未分类</SelectItem>
                          {BUCKETS.map(function (bucket) {
                            return (
                              <SelectItem
                                key={bucket}
                                value={bucket}>
                                {BUCKET_LABELS[bucket]}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
              </Section>

              <Section
                icon={<Glyph icon="mdi:import" />}
                tileClass="bg-chart-1/15 text-chart-1"
                title="输入"
                count={content.inputs.length}>
                <InputsEditor
                  inputs={content.inputs}
                  onChange={function (next) {
                    const previous = content.inputs
                    setInputValues(function (prev) {
                      return {
                        ...prev,
                        [activeName]: relocateInputValues(previous, next, prev[activeName] ?? {})
                      }
                    })
                    patchContent({ inputs: next })
                  }}
                />
              </Section>

              {/*
                运行参数与输入声明分开：这里填的只是**这一次**运行传什么，不写回指令；
                过去两者挤在一个「输入」区里，看着像在改指令，其实只是填表单。
              */}
              <Section
                icon={<Glyph icon="mdi:play-circle-outline" />}
                tileClass="bg-chart-2/18 text-chart-2"
                title="运行参数"
                hint="只影响本次运行，不写入指令">
                {content.inputs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-center text-xs text-muted-foreground">
                    这条指令没有声明输入
                  </p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {content.inputs.map(function (input, index) {
                      return (
                        <Field
                          key={index}
                          label={input.name || '(未命名)'}
                          required={Boolean(input.required)}
                          hint={input.description || undefined}>
                          <Input
                            className={CONTROL_CLASS}
                            value={values[input.name] ?? ''}
                            placeholder="本次运行的值"
                            onChange={function (event) {
                              setInput(input.name, event.target.value)
                            }}
                          />
                        </Field>
                      )
                    })}
                  </div>
                )}
              </Section>

              <Section
                icon={<Glyph icon="mdi:code-braces" />}
                tileClass="bg-chart-4/22 text-foreground"
                title="变量"
                count={Object.keys(content.variables ?? {}).length}>
                <VariablesEditor
                  variables={content.variables ?? {}}
                  onChange={function (next) {
                    patchContent({ variables: next })
                  }}
                />
              </Section>

              <Section
                icon={<Glyph icon="mdi:shield-check-outline" />}
                tileClass="bg-chart-3/18 text-chart-3"
                title="权限">
                <PermissionsEditor
                  permissions={content.permissions ?? {}}
                  onChange={function (next) {
                    patchContent({ permissions: next })
                  }}
                />
              </Section>

              <Section
                icon={<Glyph icon="mdi:lightning-bolt-outline" />}
                tileClass="bg-primary/12 text-primary"
                title="触发器"
                count={(content.triggers ?? []).length}>
                <TriggersEditor
                  triggers={content.triggers ?? []}
                  onChange={function (next) {
                    patchContent({ triggers: next })
                  }}
                />
              </Section>
            </aside>
          </Glide.Y>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel
          id={STEPS_ID}
          minSize={STEPS_MIN}
          className="h-full min-h-0 min-w-0">
          <Glide.Y>
            <main className="flex flex-col gap-3 p-3.5">
              <header className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-3.5 py-2.5 shadow-xs">
                <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
                    <Glyph icon="mdi:format-list-numbered" />
                  </span>
                  步骤
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                    {content.steps.length}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span
                    title="步骤自己没写 on_error 时，按这个策略走"
                    className="text-xs text-muted-foreground">
                    失败时
                  </span>
                  <div className="w-44">
                    <OnErrorSelect
                      value={content.on_error ?? 'abort'}
                      onChange={function (next) {
                        patchContent({ on_error: next === 'abort' ? undefined : next })
                      }}
                    />
                  </div>
                </div>
              </header>

              {content.steps.length === 0 ? (
                <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-border/70 bg-card/60 py-10 text-xs text-muted-foreground">
                  <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted">
                    <Glyph
                      icon="mdi:playlist-plus"
                      className="size-5 opacity-80"
                    />
                  </span>
                  <p>从下方添加步骤，编排自定义组合</p>
                </div>
              ) : null}
              <div className="flex flex-col gap-2.5">
                {content.steps.map(function (step, index) {
                  const node = step as Step
                  const enter = isReducedMotion ? CARD_ENTER.reduced : CARD_ENTER
                  return (
                    <motion.div
                      key={node.token ?? `step-${index}`}
                      initial={enter.initial}
                      animate={enter.animate}
                      transition={isReducedMotion ? STEP_TRANSITION_REDUCED : STEP_TRANSITION}>
                      <StepNode
                        step={node}
                        catalog={catalog}
                        index={index}
                        count={content.steps.length}
                        onChange={onStepChange}
                        onRemove={onStepRemove}
                        onDuplicate={onStepDuplicate}
                        onMove={onStepMove}
                      />
                    </motion.div>
                  )
                })}
                <AddStepButton
                  catalog={catalog}
                  onPick={function (action: CorexAction) {
                    updateContent(function (prev) {
                      return {
                        ...prev,
                        steps: [
                          ...prev.steps,
                          {
                            id: nextStepId(action.id, prev.steps),
                            token: nextToken(),
                            action: action.id
                          }
                        ]
                      }
                    })
                  }}
                  onAddKind={function (kind) {
                    updateContent(function (prev) {
                      return {
                        ...prev,
                        steps: [...prev.steps, buildControlStep(kind, nextStepId(kind, prev.steps))]
                      }
                    })
                  }}
                />
              </div>
            </main>
          </Glide.Y>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/*
        YAML 只读：这一份是 corex 从模型序列化出来的，用来和「编辑器里看到的」对账；
        要改就改上面的表单 —— 在这里改不会生效，也没有回写通道。
      */}
      <Dialog
        open={isYamlOpen}
        onOpenChange={setIsYamlOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>YAML · {content.name}</DialogTitle>
            <DialogDescription>
              corex 落库的那一份（只读）。改这里不会生效，请改表单。
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre">
            {yamls[activeName] ?? ''}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default memo(Editor)
