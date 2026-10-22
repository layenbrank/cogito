import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Progress } from '@i-thinking/design/components/progress'
import { cn } from 'cn'

import type { CorexRun } from '@/stores/corex.ts'
import { RUN_STATUS_STYLES } from './run-status'

interface RunPanelStatusProps {
  activeRun: CorexRun
  stepCount: number
  /** 仅在「输出」通道有意义：停手后可一键贴底 */
  isFollowing?: boolean
  onResumeFollow?: () => void
}

function RunPanelStatus(props: RunPanelStatusProps) {
  const statusStyle = RUN_STATUS_STYLES[props.activeRun.status]
  const progressValue =
    props.stepCount > 0
      ? Math.min(100, (props.activeRun.doneSteps / props.stepCount) * 100)
      : props.activeRun.status === 'running'
        ? 8
        : props.activeRun.status === 'ok'
          ? 100
          : 0
  const showResume =
    props.isFollowing === false && typeof props.onResumeFollow === 'function'

  return (
    <div className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <Badge
          variant={
            props.activeRun.status === 'ok'
              ? 'success'
              : props.activeRun.status === 'failed'
                ? 'destructive'
                : 'outline'
          }
          className={cn(
            'gap-1.5 font-normal',
            props.activeRun.status === 'running' && statusStyle.tone
          )}>
          <span
            aria-hidden
            className={cn(
              'size-1.5 rounded-full',
              statusStyle.dot,
              props.activeRun.status === 'running' && 'animate-pulse'
            )}
          />
          {statusStyle.label}
        </Badge>
        <span className="truncate font-medium">{props.activeRun.name}</span>
        {props.stepCount > 0 ? (
          <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
            {props.activeRun.doneSteps}/{props.stepCount} 步
          </span>
        ) : null}
        {showResume ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs"
            onClick={props.onResumeFollow}>
            回到底部
          </Button>
        ) : null}
      </div>
      <Progress
        className="mt-1.5 h-1"
        value={progressValue}
      />
      {props.activeRun.error ? (
        <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-destructive">
          {props.activeRun.error}
        </p>
      ) : null}
    </div>
  )
}

export { RunPanelStatus }
