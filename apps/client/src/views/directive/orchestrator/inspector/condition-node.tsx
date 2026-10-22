import { makeCondition, conditionKind } from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'
import type { ParamRefContext } from '@/views/directive/orchestrator/inspector/param-ref.ts'

import { ConditionKindSelect } from '@/views/directive/orchestrator/inspector/condition-kind-select.tsx'
import { ConditionNodeCompare } from '@/views/directive/orchestrator/inspector/condition-node-compare.tsx'
import { ConditionNodeExpr } from '@/views/directive/orchestrator/inspector/condition-node-expr.tsx'
import { ConditionNodeLogic } from '@/views/directive/orchestrator/inspector/condition-node-logic.tsx'

interface ConditionNodeProps {
  condition: Condition
  refContext: ParamRefContext
  onChange: (next: Condition) => void
}

function ConditionNodeNot(props: ConditionNodeProps) {
  const kind = conditionKind(props.condition)
  if (kind !== 'not' || typeof props.condition === 'string') return null

  function onKindChange(next: ConditionKind) {
    if (next === kind) return
    props.onChange(makeCondition(next))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <ConditionKindSelect
          kind={kind}
          onChange={onKindChange}
        />
        <span className="text-xs text-muted-foreground">取反</span>
      </div>
      <ConditionNode
        condition={props.condition.not ?? ''}
        refContext={props.refContext}
        onChange={function (next) {
          props.onChange({ not: next })
        }}
      />
    </div>
  )
}

function ConditionNode(props: ConditionNodeProps) {
  const kind = conditionKind(props.condition)

  if (kind === 'expr' || typeof props.condition === 'string') {
    return (
      <ConditionNodeExpr
        kind={kind}
        value={typeof props.condition === 'string' ? props.condition : ''}
        refContext={props.refContext}
        onChange={props.onChange}
      />
    )
  }

  if (kind === 'and' || kind === 'or') {
    return (
      <ConditionNodeLogic
        kind={kind}
        condition={props.condition}
        refContext={props.refContext}
        onChange={props.onChange}
      />
    )
  }

  if (kind === 'not') {
    return (
      <ConditionNodeNot
        condition={props.condition}
        refContext={props.refContext}
        onChange={props.onChange}
      />
    )
  }

  return (
    <ConditionNodeCompare
      kind={kind}
      condition={props.condition}
      refContext={props.refContext}
      onChange={props.onChange}
    />
  )
}

export { ConditionNode }
