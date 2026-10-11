import { Input } from '@i-thinking/design/components/input'

import {
  COMPARE_PLACEHOLDER,
  CONDITION_LABELS,
  makeCondition,
  parseOperand
} from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'

import { ConditionKindSelect } from '@/views/directive/orchestrator/inspector/condition-kind-select.tsx'
import { operandText } from '@/views/directive/orchestrator/inspector/condition-operand.ts'

interface ConditionNodeCompareProps {
  kind: Exclude<ConditionKind, 'expr' | 'and' | 'or' | 'not'>
  condition: Condition
  onChange: (next: Condition) => void
}

function ConditionNodeCompare(props: ConditionNodeCompareProps) {
  const pair = (props.condition as Record<string, [unknown, unknown]>)[props.kind] ?? ['', '']

  function onKindChange(next: ConditionKind) {
    if (next === props.kind) return
    props.onChange(makeCondition(next))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <ConditionKindSelect
          kind={props.kind}
          onChange={onKindChange}
        />
        <span className="text-xs text-muted-foreground">{CONDITION_LABELS[props.kind]}</span>
      </div>
      <Input
        value={operandText(pair[0])}
        onChange={function (event) {
          props.onChange({
            ...props.condition,
            [props.kind]: [parseOperand(event.target.value), pair[1]]
          })
        }}
        placeholder={COMPARE_PLACEHOLDER[props.kind][0]}
      />
      <Input
        value={operandText(pair[1])}
        onChange={function (event) {
          props.onChange({
            ...props.condition,
            [props.kind]: [pair[0], parseOperand(event.target.value)]
          })
        }}
        placeholder={COMPARE_PLACEHOLDER[props.kind][1]}
      />
    </div>
  )
}

export { ConditionNodeCompare }
