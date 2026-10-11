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
import { Icon } from '@iconify/react/offline'

import {
  COMPARE_PLACEHOLDER,
  CONDITION_KINDS,
  CONDITION_LABELS,
  conditionKind,
  makeCondition,
  parseOperand
} from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'

interface ConditionFieldProps {
  value: Condition | undefined
  onChange: (next: Condition | undefined) => void
  label?: string
}

function operandText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function KindSelect(props: { kind: ConditionKind; onChange: (kind: ConditionKind) => void }) {
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
        className="w-28 shrink-0"
        aria-label="条件类型">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
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

function ConditionNode(props: { condition: Condition; onChange: (next: Condition) => void }) {
  const condition = props.condition
  const kind = conditionKind(condition)

  function onKindChange(next: ConditionKind) {
    if (next === kind) return
    props.onChange(makeCondition(next))
  }

  if (kind === 'expr' || typeof condition === 'string') {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <KindSelect
          kind={kind}
          onChange={onKindChange}
        />
        <Input
          className="min-w-0 flex-1"
          value={typeof condition === 'string' ? condition : ''}
          placeholder="如 {{variables.enabled}}"
          onChange={function (event) {
            props.onChange(event.target.value)
          }}
        />
      </div>
    )
  }

  if (kind === 'and' || kind === 'or') {
    const list = (kind === 'and' ? condition.and : condition.or) ?? []
    return (
      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed p-2">
        <div className="flex items-center gap-1.5">
          <KindSelect
            kind={kind}
            onChange={onKindChange}
          />
          <span className="text-xs text-muted-foreground">
            {kind === 'and' ? '全部满足' : '满足其一'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2"
            onClick={function () {
              props.onChange({ ...condition, [kind]: [...list, ''] })
            }}>
            <Icon
              icon="lucide:plus"
              className="size-3.5"
            />
            添加
          </Button>
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-muted-foreground">还没有子条件</p>
        ) : (
          list.map(function (child, index) {
            return (
              <div
                key={`${kind}-${index}`}
                className="flex gap-1.5">
                <div className="min-w-0 flex-1">
                  <ConditionNode
                    condition={child}
                    onChange={function (next) {
                      const nextList = [...list]
                      nextList[index] = next
                      props.onChange({ ...condition, [kind]: nextList })
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8 shrink-0"
                  aria-label="删除子条件"
                  onClick={function () {
                    props.onChange({
                      ...condition,
                      [kind]: list.filter(function (_, i) {
                        return i !== index
                      })
                    })
                  }}>
                  <Icon
                    icon="lucide:x"
                    className="size-3.5"
                  />
                </Button>
              </div>
            )
          })
        )}
      </div>
    )
  }

  if (kind === 'not') {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <KindSelect
            kind={kind}
            onChange={onKindChange}
          />
          <span className="text-xs text-muted-foreground">取反</span>
        </div>
        <ConditionNode
          condition={condition.not ?? ''}
          onChange={function (next) {
            props.onChange({ not: next })
          }}
        />
      </div>
    )
  }

  const pair = (condition[kind] as [unknown, unknown] | undefined) ?? ['', '']
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <KindSelect
          kind={kind}
          onChange={onKindChange}
        />
        <span className="text-xs text-muted-foreground">{CONDITION_LABELS[kind]}</span>
      </div>
      <Input
        value={operandText(pair[0])}
        onChange={function (event) {
          props.onChange({
            ...condition,
            [kind]: [parseOperand(event.target.value), pair[1]]
          })
        }}
        placeholder={COMPARE_PLACEHOLDER[kind][0]}
      />
      <Input
        value={operandText(pair[1])}
        onChange={function (event) {
          props.onChange({
            ...condition,
            [kind]: [pair[0], parseOperand(event.target.value)]
          })
        }}
        placeholder={COMPARE_PLACEHOLDER[kind][1]}
      />
    </div>
  )
}

function ConditionField(props: ConditionFieldProps) {
  return (
    <div className="space-y-2">
      {props.label ? <Label>{props.label}</Label> : null}
      {props.value === undefined ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={function () {
            props.onChange('')
          }}>
          添加条件
        </Button>
      ) : (
        <div className="space-y-2">
          <ConditionNode
            condition={props.value}
            onChange={props.onChange}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="px-0 text-muted-foreground"
            onClick={function () {
              props.onChange(undefined)
            }}>
            清除条件
          </Button>
        </div>
      )}
    </div>
  )
}

export { ConditionField }
