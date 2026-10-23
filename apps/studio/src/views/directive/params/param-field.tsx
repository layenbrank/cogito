import { Badge } from '@cogito/design/components/badge'
import { Checkbox } from '@cogito/design/components/checkbox'
import { Input } from '@cogito/design/components/input'
import { Label } from '@cogito/design/components/label'
import { Textarea } from '@cogito/design/components/textarea'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { useId } from 'react'

import type { CorexAction } from '@/stores/corex'

import { CONTROL_CLASS, HintTooltip, TEXTAREA_CLASS } from '@/views/directive/editor/controls'
import { checkValue, findFieldHint, findFieldKind, formatField, parseInput } from './field'
import type { FieldKind } from './field'

/**
 * 一个动作参数的录入控件：名字 / 类型 / 必填 / 说明 + 对应控件，填错了当场标出来。
 * 动作库试跑与编辑器步骤表单共用它，两边「什么类型长什么样、什么算填对」保持一份。
 *
 * 长说明收进 ⓘ tooltip（关闭即销毁），窄步骤栏里少占一截纵向空间。
 */

type ActionParam = CorexAction['params'][number]

interface Props {
  param: ActionParam
  /** 当前取值；`undefined` = 不传这个参数，corex 用自己的默认值 */
  value: unknown
  onChange: (value: unknown) => void
  className?: string
}

interface ControlProps {
  param: ActionParam
  kind: FieldKind
  value: unknown
  onChange: (value: unknown) => void
}

function ParamControl(props: ControlProps) {
  const { param, kind } = props
  const text = formatField(param, props.value)
  const hint = findFieldHint(param.ty)

  function change(next: string): void {
    props.onChange(parseInput(param, next))
  }

  if (kind === 'json') {
    return (
      <Textarea
        aria-label={param.name}
        className={cn(TEXTAREA_CLASS, 'font-mono')}
        placeholder={hint}
        value={text}
        onChange={function (event) {
          change(event.target.value)
        }}
      />
    )
  }

  return (
    <Input
      type={kind === 'secret' ? 'password' : 'text'}
      inputMode={kind === 'number' ? 'decimal' : undefined}
      aria-label={param.name}
      className={cn(CONTROL_CLASS, kind === 'number' && 'font-mono')}
      placeholder={hint}
      value={text}
      onChange={function (event) {
        change(event.target.value)
      }}
    />
  )
}

function ParamField(props: Props) {
  const { param } = props
  const id = useId()
  const kind = findFieldKind(param.ty)
  const problem = checkValue(param, props.value)
  const isCheckbox = kind === 'checkbox'

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', props.className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {isCheckbox ? (
          <Checkbox
            id={id}
            checked={props.value === true}
            onCheckedChange={function (checked) {
              props.onChange(checked === true)
            }}
          />
        ) : null}

        <Label
          htmlFor={id}
          className="min-w-0 truncate font-mono text-xs font-medium text-foreground">
          {param.name}
          {param.required ? <span className="text-destructive"> *</span> : null}
        </Label>

        <Badge
          variant="outline"
          className="border-border/70 px-1.5 py-0 text-xs font-normal text-foreground/65">
          {param.ty}
        </Badge>

        {param.description ? (
          <HintTooltip
            hint={param.description}
            label={`${param.name} 说明`}
          />
        ) : null}
      </div>

      {isCheckbox ? null : (
        <ParamControl
          param={param}
          kind={kind}
          value={props.value}
          onChange={props.onChange}
        />
      )}

      {problem ? (
        <p className="flex items-start gap-1 text-xs leading-snug text-destructive">
          <Icon
            icon="mdi:alert-circle-outline"
            className="mt-px size-3 shrink-0"
          />
          {problem}
        </p>
      ) : null}
    </div>
  )
}

export { ParamField }
