import { Input } from '@i-thinking/design/components/input'
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

import type { ActionEntry } from '@/shared/ipc/specs/sidecar'

type ActionParam = ActionEntry['params'][number]

interface ParamFieldsProps {
  params: ActionParam[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
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
      return /^[\w.\-]+$/.test(part)
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
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
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
              <div className="flex items-center justify-between gap-2">
                {label}
                <Switch
                  checked={current === true}
                  onCheckedChange={function (checked) {
                    writeParam(param.name, checked === true)
                  }}
                />
              </div>
              {param.description ? (
                <p className="text-xs text-muted-foreground">{param.description}</p>
              ) : null}
            </div>
          )
        }

        if (options) {
          const selected =
            typeof current === 'string' && options.includes(current) ? current : '__unset'
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
              <Select
                items={optionItems}
                value={selected}
                onValueChange={function (value) {
                  if (value === null) return
                  writeParam(param.name, value === '__unset' ? undefined : value)
                }}>
                <SelectTrigger
                  id={`param-${param.name}`}
                  className="w-full">
                  <SelectValue placeholder="未设置" />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
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
            </div>
          )
        }

        if (isArrayType(param.ty)) {
          return (
            <div
              key={param.name}
              className="space-y-1.5">
              {label}
              <Textarea
                id={`param-${param.name}`}
                rows={3}
                className="font-mono text-xs"
                placeholder='JSON 数组，如 ["*.md"] 或模板 ${inputs.x}'
                value={stringifyValue(current)}
                onChange={function (event) {
                  const text = event.target.value.trim()
                  if (!text) {
                    writeParam(param.name, undefined)
                    return
                  }
                  if (text.startsWith('${') || text.startsWith('{{')) {
                    writeParam(param.name, text)
                    return
                  }
                  try {
                    writeParam(param.name, JSON.parse(text) as unknown)
                  } catch {
                    writeParam(param.name, text)
                  }
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
            <Input
              id={`param-${param.name}`}
              type={isNumberType(param.ty) && typeof current === 'number' ? 'number' : 'text'}
              placeholder={
                param.default != null
                  ? `默认 ${stringifyValue(param.default)}`
                  : '值或模板，如 ${inputs.src}'
              }
              value={stringifyValue(current)}
              onChange={function (event) {
                const text = event.target.value
                if (text === '') {
                  writeParam(param.name, undefined)
                  return
                }
                if (isNumberType(param.ty) && /^-?\d+(\.\d+)?$/.test(text)) {
                  writeParam(param.name, Number(text))
                  return
                }
                writeParam(param.name, text)
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
