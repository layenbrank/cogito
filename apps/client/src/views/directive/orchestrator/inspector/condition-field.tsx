import { Button } from '@cogito/design/components/button'
import { Label } from '@cogito/design/components/label'

import type { Condition } from '@/views/directive/model/types.ts'
import type { ParamRefContext } from '@/views/directive/orchestrator/inspector/param-ref.ts'
import { ConditionNode } from '@/views/directive/orchestrator/inspector/condition-node.tsx'

interface ConditionFieldProps {
  value: Condition | undefined
  onChange: (next: Condition | undefined) => void
  label?: string
  refContext: ParamRefContext
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
            refContext={props.refContext}
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
