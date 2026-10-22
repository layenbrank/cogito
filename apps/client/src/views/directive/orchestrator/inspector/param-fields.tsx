import { Label } from '@i-thinking/design/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'
import { Switch } from '@i-thinking/design/components/switch'
import { Textarea } from '@i-thinking/design/components/textarea'
import { useEffect, useState, type ReactNode } from 'react'

import type { ActionEntry } from '@/shared/ipc/specs/sidecar'

import { ParamRefPicker, ParamRefSummary } from './param-ref-picker.tsx'
import { findPathKind, parsePureRef, type ParamRefContext } from './param-ref.ts'
import { RefValueInput } from './ref-value-input.tsx'

type ActionParam = ActionEntry['params'][number]

interface ParamFieldsProps {
  params: ActionParam[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  /** 可供点选的 variables / inputs / steps / env */
  refContext: ParamRefContext
}

function parseEnumOptions(param: ActionParam): string[] | null {
  const source = param.description ?? ''
  if (!source.includes('|')) return null
  const parts = source
    .split('|')
    .map(function (part) {
      return part.trim()
    })
    .filter(Boolean)
  if (parts.length < 2) return null
  if (
    parts.every(function (part) {
      return /^[\w.-]+$/.test(part)
    })
  ) {
    return parts
  }
  return null
}

function isBoolType(ty: string): boolean {
  return /^(bool|boolean)$/i.test(ty.trim())
}

function isNumberType(ty: string): boolean {
  return /^(int|integer|number|float|f64|f32|u\d+|i\d+)$/i.test(ty.trim())
}

function isArrayType(ty: string): boolean {
  return /array|list|\[\]/i.test(ty)
}

function stringifyValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? ''
  } catch (error) {
    console.debug('[directive] 参数值无法序列化，按空串处理:', error)
    return ''
  }
}

interface RefAwareControlProps {
  id: string
  value: unknown
  refContext: ParamRefContext
  onWrite: (value: unknown) => void
  /** 非引用态的字面量控件 */
  literal: (helpers: {
    value: unknown
    onWrite: (value: unknown) => void
    onPickRef: (wrapped: string) => void
    purePath: string | null
  }) => ReactNode
}

/**
 * 纯 `{{…}}` → 引用摘要；否则字面量。
 * 「改为手写」强制字面量；在字面量里写完整一段 `{{expr}}` 后失焦则自动回到引用态。
 */
function RefAwareControl(props: RefAwareControlProps) {
  const purePath = parsePureRef(props.value)
  const [forceLiteral, setForceLiteral] = useState(false)
  const showRef = Boolean(purePath) && !forceLiteral

  useEffect(
    function () {
      // 外部已不是纯引用时，清掉强制字面量标记
      if (!purePath) setForceLiteral(false)
    },
    [purePath]
  )

  function pickRef(wrapped: string) {
    setForceLiteral(false)
    props.onWrite(wrapped)
  }

  if (showRef && purePath) {
    return (
      <ParamRefSummary
        path={purePath}
        context={props.refContext}
        onChange={pickRef}
        onClear={function () {
          setForceLiteral(false)
          props.onWrite(undefined)
        }}
        onEditLiteral={function () {
          setForceLiteral(true)
        }}
      />
    )
  }

  return (
    <>
      {props.literal({
        value: props.value,
        onWrite: props.onWrite,
        onPickRef: pickRef,
        purePath
      })}
    </>
  )
}

function ParamFields(props: ParamFieldsProps) {
  function writeParam(name: string, value: unknown) {
    const next = { ...props.values }
    if (value === undefined || value === '') delete next[name]
    else next[name] = value
    props.onChange(next)
  }

  if (props.params.length === 0) {
    return <p className="text-xs text-muted-foreground">该动作没有声明参数。</p>
  }

  return (
    <div className="space-y-3">
      {props.params.map(function (param) {
        const current = props.values[param.name]
        const options = parseEnumOptions(param)
        const label = (
          <Label
            htmlFor={`param-${param.name}`}
            className="flex items-baseline gap-1">
            <span>{param.name}</span>
            {param.required ? <span className="text-destructive">*</span> : null}
            <span className="font-normal text-muted-foreground">· {param.ty}</span>
          </Label>
        )

        if (isBoolType(param.ty)) {
          return (
            <div
              key={param.name}
              className="space-y-1.5">
              {label}
              <RefAwareControl
                id={`param-${param.name}`}
                value={current}
                refContext={props.refContext}
                onWrite={function (value) {
                  writeParam(param.name, value)
                }}
                literal={function (helpers) {
                  return (
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`param-${param.name}`}
                        checked={helpers.value === true}
                        onCheckedChange={function (checked) {
                          helpers.onWrite(checked === true)
                        }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {helpers.value === true ? 'true' : 'false'}
                      </span>
                      <ParamRefPicker
                        context={props.refContext}
                        currentPath={helpers.purePath}
                        onPick={helpers.onPickRef}
                      />
                    </div>
                  )
                }}
              />
              {param.description ? (
                <p className="text-xs text-muted-foreground">{param.description}</p>
              ) : null}
            </div>
          )
        }

        if (options) {
          const optionItems = Object.fromEntries([
            ['__unset', '未设置'],
            ...options.map(function (option) {
              return [option, option] as const
            })
          ])
          return (
            <div
              key={param.name}
              className="space-y-1.5">
              {label}
              <RefAwareControl
                id={`param-${param.name}`}
                value={current}
                refContext={props.refContext}
                onWrite={function (value) {
                  writeParam(param.name, value)
                }}
                literal={function (helpers) {
                  const selected =
                    typeof helpers.value === 'string' && options.includes(helpers.value)
                      ? helpers.value
                      : '__unset'
                  return (
                    <div className="flex gap-1">
                      <Select
                        items={optionItems}
                        value={selected}
                        onValueChange={function (value) {
                          if (value === null) return
                          helpers.onWrite(value === '__unset' ? undefined : value)
                        }}>
                        <SelectTrigger
                          id={`param-${param.name}`}
                          className="min-w-0 flex-1">
                          <SelectValue placeholder="未设置" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unset">未设置</SelectItem>
                          {options.map(function (option) {
                            return (
                              <SelectItem
                                key={option}
                                value={option}>
                                {option}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                      <ParamRefPicker
                        context={props.refContext}
                        currentPath={helpers.purePath}
                        onPick={helpers.onPickRef}
                      />
                    </div>
                  )
                }}
              />
            </div>
          )
        }

        if (isArrayType(param.ty)) {
          return (
            <div
              key={param.name}
              className="space-y-1.5">
              {label}
              <RefAwareControl
                id={`param-${param.name}`}
                value={current}
                refContext={props.refContext}
                onWrite={function (value) {
                  writeParam(param.name, value)
                }}
                literal={function (helpers) {
                  return (
                    <div className="relative">
                      <Textarea
                        id={`param-${param.name}`}
                        rows={3}
                        className="pr-9 font-mono text-xs"
                        placeholder='JSON 数组，如 ["*.md"]；或点右侧选引用'
                        value={stringifyValue(helpers.value)}
                        onChange={function (event) {
                          const text = event.target.value.trim()
                          if (!text) {
                            helpers.onWrite(undefined)
                            return
                          }
                          if (text.startsWith('{{')) {
                            helpers.onWrite(text)
                            return
                          }
                          try {
                            helpers.onWrite(JSON.parse(text) as unknown)
                          } catch (error) {
                            console.debug('[directive] 参数不是 JSON，按纯文本处理:', error)
                            helpers.onWrite(text)
                          }
                        }}
                        onBlur={function () {
                          if (parsePureRef(helpers.value)) helpers.onPickRef(String(helpers.value))
                        }}
                      />
                      <div className="absolute top-1.5 right-1.5">
                        <ParamRefPicker
                          context={props.refContext}
                          currentPath={helpers.purePath}
                          onPick={helpers.onPickRef}
                        />
                      </div>
                    </div>
                  )
                }}
              />
              {param.description ? (
                <p className="text-xs text-muted-foreground">{param.description}</p>
              ) : null}
            </div>
          )
        }

        return (
          <div
            key={param.name}
            className="space-y-1.5">
            {label}
            <RefValueInput
              id={`param-${param.name}`}
              value={stringifyValue(current)}
              refContext={props.refContext}
              pathKind={findPathKind(param)}
              placeholder={
                param.default !== undefined && param.default !== null
                  ? `默认 ${stringifyValue(param.default)}`
                  : '字面量，或点右侧插入引用'
              }
              onChange={function (next) {
                if (next === '') {
                  writeParam(param.name, undefined)
                  return
                }
                if (isNumberType(param.ty) && /^-?\d+(\.\d+)?$/.test(next)) {
                  writeParam(param.name, Number(next))
                  return
                }
                writeParam(param.name, next)
              }}
            />
            {param.description ? (
              <p className="text-xs text-muted-foreground">{param.description}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export { ParamFields }
