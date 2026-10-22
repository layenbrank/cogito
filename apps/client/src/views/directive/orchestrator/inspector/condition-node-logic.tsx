import { Button } from '@i-thinking/design/components/button'
import { Icon } from '@iconify/react/offline'

import { makeCondition } from '@/views/directive/model/condition.ts'
import type { ConditionKind, ConditionObject } from '@/views/directive/model/condition.ts'
import type { Condition } from '@/views/directive/model/types.ts'
import type { ParamRefContext } from '@/views/directive/orchestrator/inspector/param-ref.ts'

import { ConditionKindSelect } from '@/views/directive/orchestrator/inspector/condition-kind-select.tsx'
import { conditionChildKey } from '@/views/directive/orchestrator/inspector/condition-operand.ts'
import { ConditionNode } from '@/views/directive/orchestrator/inspector/condition-node.tsx'

interface ConditionNodeLogicProps {
  kind: 'and' | 'or'
  condition: ConditionObject
  refContext: ParamRefContext
  onChange: (next: Condition) => void
}

function ConditionNodeLogic(props: ConditionNodeLogicProps) {
  const children = (props.kind === 'and' ? props.condition.and : props.condition.or) ?? []

  function onKindChange(next: ConditionKind) {
    if (next === props.kind) return
    props.onChange(makeCondition(next))
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-md border border-dashed p-2">
      <div className="flex items-center gap-1.5">
        <ConditionKindSelect
          kind={props.kind}
          onChange={onKindChange}
        />
        <span className="text-xs text-muted-foreground">
          {props.kind === 'and' ? '全部满足' : '满足其一'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2"
          onClick={function () {
            props.onChange({ ...props.condition, [props.kind]: [...children, ''] })
          }}>
          <Icon
            icon="lucide:plus"
            className="size-3.5"
          />
          添加
        </Button>
      </div>
      {children.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有子条件</p>
      ) : (
        children.map(function (child, index) {
          return (
            <div
              key={conditionChildKey(props.kind, child)}
              className="flex gap-1.5">
              <div className="min-w-0 flex-1">
                <ConditionNode
                  condition={child}
                  refContext={props.refContext}
                  onChange={function (next) {
                    const nextChildren = [...children]
                    nextChildren[index] = next
                    props.onChange({ ...props.condition, [props.kind]: nextChildren })
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
                    ...props.condition,
                    [props.kind]: children.filter(function (_, i) {
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

export { ConditionNodeLogic }
