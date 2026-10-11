import { Badge } from '@i-thinking/design/components/badge'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'

import {
  RUN_STATUS_STYLES,
  type DirectiveRuns
} from '@/views/directive/run/run-status'

interface DirectiveCardStatusProps {
  isParsed: boolean
  runs: DirectiveRuns
}

function DirectiveCardStatus(props: DirectiveCardStatusProps) {
  if (!props.isParsed) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 gap-1 font-normal text-destructive">
        <Icon icon="mdi:file-alert-outline" />
        解析失败
      </Badge>
    )
  }

  const status = props.runs.status ? RUN_STATUS_STYLES[props.runs.status] : null
  if (!status) return null

  const statusLabel =
    props.runs.running > 1 ? `${status.label} ×${props.runs.running}` : status.label

  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 gap-1.5 rounded-full font-normal', status.tone)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status.dot,
          props.runs.status === 'running' && 'animate-pulse'
        )}
      />
      {statusLabel}
    </Badge>
  )
}

export { DirectiveCardStatus }
