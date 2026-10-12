import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'

import { capsFromSummary } from '@/views/directive/run/run-caps'
import type { DirectiveRuns } from '@/views/directive/run/run-status'
import { formatRelativeTime } from '@/views/directive/run/run-status'

interface CardMetaProps {
  entry: DirectiveEntry
  isParsed: boolean
  runs: DirectiveRuns
  stepCount: number
  now: number
  metaTitle: string
}

function CardMeta(props: CardMetaProps) {
  const inputCount = props.entry.summary?.input_count ?? 0
  const caps = capsFromSummary(props.entry.summary)

  return (
    <div
      className="w-full min-w-0 flex-1 truncate text-xs leading-snug text-muted-foreground"
      title={props.metaTitle || undefined}>
      {props.isParsed ? (
        <span>
          {props.stepCount} 步 · {inputCount} 输入
        </span>
      ) : null}
      {caps.hasCron || caps.hasWatch ? (
        <span>
          {' · '}
          {[caps.hasCron ? 'cron' : null, caps.hasWatch ? 'watch' : null].filter(Boolean).join('/')}
        </span>
      ) : null}
      {props.runs.failed > 0 ? (
        <span className="text-destructive"> · {props.runs.failed} 次失败</span>
      ) : null}
      {props.runs.lastAt ? (
        <span className="tabular-nums">
          {' · '}
          {formatRelativeTime(props.runs.lastAt, props.now)}
        </span>
      ) : null}
    </div>
  )
}

export { CardMeta }
