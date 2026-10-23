import { Badge } from '@cogito/design/components/badge'
import { Progress } from '@cogito/design/components/progress'
import { cn } from 'cn'

import type { CorexRun } from '@/stores/corex.ts'
import { RUN_STATUS_STYLES } from './run-status'

interface RunPanelStatusProps {
  activeRun: CorexRun
  stepCount: number
  /** 错误详情改由底部输出区展示时关掉，避免双份 */
  showError?: boolean
}

function RunPanelStatus(props: RunPanelStatusProps) {
  const showError = props.showError !== false
  const statusStyle = RUN_STATUS_STYLES[props.activeRun.status]
  const progressValue =
    props.stepCount > 0
      ? Math.min(100, (props.activeRun.doneSteps / props.stepCount) * 100)
      : props.activeRun.status === 'running'
        ? 8
        : props.activeRun.status === 'ok'
          ? 100
          : 0

  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-md border px-2.5 py-1.5 text-xs">
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
      </div>
      <Progress
        className="h-1"
        value={progressValue}
      />
      {showError && props.activeRun.error ? (
        <p className="whitespace-pre-wrap wrap-break-word text-destructive">
          {props.activeRun.error}
        </p>
      ) : null}
    </div>
  )
}

export { RunPanelStatus }
