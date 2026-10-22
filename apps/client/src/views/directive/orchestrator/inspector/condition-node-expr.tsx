import { makeCondition } from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'
import type { ParamRefContext } from '@/views/directive/orchestrator/inspector/param-ref.ts'

import { ConditionKindSelect } from '@/views/directive/orchestrator/inspector/condition-kind-select.tsx'
import { RefValueInput } from '@/views/directive/orchestrator/inspector/ref-value-input.tsx'

interface ConditionNodeExprProps {
  kind: ConditionKind
  value: string
  refContext: ParamRefContext
  onChange: (next: Condition) => void
}

function ConditionNodeExpr(props: ConditionNodeExprProps) {
  function onKindChange(next: ConditionKind) {
    if (next === props.kind) return
    props.onChange(makeCondition(next))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ConditionKindSelect
        kind={props.kind}
        onChange={onKindChange}
      />
      <RefValueInput
        value={props.value}
        refContext={props.refContext}
        placeholder="真值表达式，或选引用"
        onChange={function (next) {
          props.onChange(next)
        }}
      />
    </div>
  )
}

export { ConditionNodeExpr }
