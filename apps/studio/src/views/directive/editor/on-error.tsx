import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cogito/design/components/select'

import type { OnError } from './types'

/**
 * 失败策略（corex `OnError`）：步骤自己写了 `on_error` 就按它，没写就看指令级的默认值。
 * 步骤卡片与指令面板用同一套选项，免得两处写法各说各话。
 */
const ON_ERROR_OPTIONS = ['abort', 'continue', 'skip'] as const

const ON_ERROR_LABELS: Record<OnError, string> = {
  abort: '中止',
  continue: '继续，失败记为 null',
  skip: '跳过，不记录输出'
}

interface OnErrorSelectProps {
  value: OnError
  onChange: (next: OnError) => void
}

function OnErrorSelect(props: OnErrorSelectProps) {
  return (
    <Select
      items={ON_ERROR_LABELS}
      value={props.value}
      onValueChange={function (value) {
        if (value === null) return
        props.onChange(value as OnError)
      }}>
      <SelectTrigger
        size="sm"
        className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ON_ERROR_OPTIONS.map(function (option) {
          return (
            <SelectItem
              key={option}
              value={option}>
              {option}（{ON_ERROR_LABELS[option]}）
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

export { ON_ERROR_LABELS, ON_ERROR_OPTIONS, OnErrorSelect }
