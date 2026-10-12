import { Button } from '@i-thinking/design/components/button'
import { Progress } from '@i-thinking/design/components/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import type { MouseEvent } from 'react'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'

import { CardMeta } from './card-meta.tsx'
import { capsFromSummary } from '@/views/directive/run/run-caps'
import {
  type DirectiveRuns,
  formatAbsoluteTime,
  formatDuration
} from '@/views/directive/run/run-status'
import { WallRunBar } from '@/views/directive/run/run-menu'

interface CardFooterProps {
  entry: DirectiveEntry
  isParsed: boolean
  runs: DirectiveRuns
  stepCount: number
  now: number
  onRun: (name: string) => void
  onDelete: (name: string) => void
}

function CardFooter(props: CardFooterProps) {
  const inputCount = props.entry.summary?.input_count ?? 0
  const caps = capsFromSummary(props.entry.summary)
  const ranAtTitle = props.runs.lastAt
    ? `最近执行：${formatAbsoluteTime(props.runs.lastAt)}${props.runs.lastDurationMs === null ? '' : `（耗时 ${formatDuration(props.runs.lastDurationMs)}）`}`
    : ''

  const metaTitle = [
    props.isParsed ? `${props.stepCount} 步 · ${inputCount} 输入` : '',
    props.runs.failed > 0 ? `${props.runs.failed} 次失败` : '',
    ranAtTitle
  ]
    .filter(Boolean)
    .join(' · ')

  function haltBubble(event: MouseEvent) {
    event.stopPropagation()
  }

  function handleDelete(event: MouseEvent) {
    event.stopPropagation()
    props.onDelete(props.entry.name)
  }

  return (
    <div className="mt-auto flex min-w-0 flex-col gap-1.5 pl-10.5">
      {props.runs.status === 'running' && props.stepCount > 0 ? (
        <div className="flex items-center gap-2">
          <Progress
            value={Math.min(100, (props.runs.doneSteps / props.stepCount) * 100)}
            className="h-1 bg-primary/15"
            aria-label={`${props.entry.name} 运行进度`}
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {props.runs.doneSteps}/{props.stepCount}
          </span>
        </div>
      ) : null}
      <div
        className="flex min-w-0 items-center gap-1.5"
        onClick={haltBubble}
        onPointerDown={haltBubble}>
        <CardMeta
          entry={props.entry}
          isParsed={props.isParsed}
          runs={props.runs}
          stepCount={props.stepCount}
          now={props.now}
          metaTitle={metaTitle}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="relative z-10 h-8 w-8 shrink-0 cursor-pointer border-border/80 text-muted-foreground opacity-70 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive group-hover/card:opacity-100 focus-visible:opacity-100"
                aria-label={`删除 ${props.entry.name}`}
                title={`删除 ${props.entry.name}`}
                onClick={handleDelete}>
                <Icon
                  icon="mdi:trash-can-outline"
                  className="size-4"
                />
              </Button>
            }
          />
          <TooltipContent side="top">删除 {props.entry.name}</TooltipContent>
        </Tooltip>
        {props.isParsed ? (
          <WallRunBar
            name={props.entry.name}
            caps={caps}
            disabled={!props.isParsed}
            onOnce={function () {
              props.onRun(props.entry.name)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export { CardFooter }
