import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@i-thinking/design/components/select'

import { CONDITION_KINDS, CONDITION_LABELS } from '@/views/directive/model/condition.ts'
import type { ConditionKind } from '@/views/directive/model/condition.ts'

interface ConditionKindSelectProps {
  kind: ConditionKind
  onChange: (kind: ConditionKind) => void
}

function ConditionKindSelect(props: ConditionKindSelectProps) {
  return (
    <Select
      items={CONDITION_LABELS}
      value={props.kind}
      onValueChange={function (value) {
        if (value === null) return
        props.onChange(value)
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

export { ConditionKindSelect }
