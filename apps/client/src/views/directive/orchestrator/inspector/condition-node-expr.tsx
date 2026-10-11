import { Input } from '@i-thinking/design/components/input'

import { makeCondition } from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'

import { ConditionKindSelect } from '@/views/directive/orchestrator/inspector/condition-kind-select.tsx'

interface ConditionNodeExprProps {
  kind: ConditionKind
  value: string
  onChange: (next: Condition) => void
}

function ConditionNodeExpr(props: ConditionNodeExprProps) {
  function onKindChange(next: ConditionKind) {
    if (next === props.kind) return
    props.onChange(makeCondition(next))
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ConditionKindSelect
        kind={props.kind}
        onChange={onKindChange}
      />
      <Input
        className="min-w-0 flex-1"
        value={props.value}
        placeholder="如 {{variables.enabled}}"
        onChange={function (event) {
          props.onChange(event.target.value)
        }}
      />
    </div>
  )
}

export { ConditionNodeExpr }
