import { Badge } from '@i-thinking/design/components/badge'
import { Button } from '@i-thinking/design/components/button'
import { Progress } from '@i-thinking/design/components/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@i-thinking/design/components/tooltip'
import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { memo, type MouseEvent } from 'react'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'

import {
  RUN_STATUS_STYLES,
  type DirectiveRuns,
  formatAbsoluteTime,
  formatDuration,
  formatRelativeTime
} from '@/views/directive/run/run-status'
import { capsFromSummary } from '@/views/directive/run/run-caps'
import { WallRunBar } from '@/views/directive/run/run-menu'
import { findBucketMark } from './bucket'

interface Props {
  entry: DirectiveEntry
  isActive: boolean
  runs: DirectiveRuns
  stepCount: number
  now: number
  onOpen: (name: string) => void
  onRun: (name: string) => void
  onDelete: (name: string) => void
}

function DirectiveCard(props: Props) {
  const { entry, runs } = props
  const isParsed = entry.summary !== null
  const status = isParsed && runs.status ? RUN_STATUS_STYLES[runs.status] : null
  const mark = findBucketMark(entry.bucket)
  const inputCount = entry.summary?.input_count ?? 0
  const statusLabel =
    status && runs.running > 1 ? `${status.label} ×${runs.running}` : (status?.label ?? '')
  const ranAtTitle = runs.lastAt
    ? `最近执行：${formatAbsoluteTime(runs.lastAt)}${runs.lastDurationMs === null ? '' : `（耗时 ${formatDuration(runs.lastDurationMs)}）`}`
    : ''
  const description = entry.summary?.description ?? ''
  const caps = capsFromSummary(entry.summary)

  const statusBadge = !isParsed ? (
    <Badge
      variant="outline"
      className="shrink-0 gap-1 font-normal text-destructive">
      <Icon icon="mdi:file-alert-outline" />
      解析失败
    </Badge>
  ) : status ? (
    <Badge
      variant="outline"
      className={cn('shrink-0 gap-1.5 rounded-full font-normal', status.tone)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          status.dot,
          runs.status === 'running' && 'animate-pulse'
        )}
      />
      {statusLabel}
    </Badge>
  ) : null

  function haltBubble(event: MouseEvent) {
    event.stopPropagation()
  }

  function handleDelete(event: MouseEvent) {
    event.stopPropagation()
    props.onDelete(entry.name)
  }

  const metaTitle = [
    isParsed ? `${props.stepCount} 步 · ${inputCount} 输入` : '',
    runs.failed > 0 ? `${runs.failed} 次失败` : '',
    ranAtTitle
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      className={cn(
        'group/card relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-xs',
        'transition-[border-color,background-color,box-shadow] duration-200',
        'active:bg-accent-active',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
        props.isActive
          ? 'border-primary bg-accent text-accent-foreground shadow-xs'
          : 'border-border/70 hover:border-border hover:bg-accent-hover hover:shadow-md'
      )}
      onClick={function () {
        props.onOpen(entry.name)
      }}>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2.5">
          <span
            title={mark.label}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-xl',
              mark.tile
            )}>
            <Icon
              icon={mark.icon}
              className="size-4"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span
                title={entry.name}
                className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
                {entry.name}
              </span>
              {statusBadge}
            </div>
            {description ? (
              <p
                title={description}
                className="truncate text-xs leading-snug text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto flex min-w-0 flex-col gap-1.5 pl-10.5">
          {runs.status === 'running' && props.stepCount > 0 ? (
            <div className="flex items-center gap-2">
              <Progress
                value={Math.min(100, (runs.doneSteps / props.stepCount) * 100)}
                className="h-1 bg-primary/15"
                aria-label={`${entry.name} 运行进度`}
              />
              <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                {runs.doneSteps}/{props.stepCount}
              </span>
            </div>
          ) : null}
          <div
            className="flex min-w-0 items-center gap-1.5"
            onClick={haltBubble}
            onPointerDown={haltBubble}>
            <div
              className="w-full min-w-0 flex-1 truncate text-xs leading-snug text-muted-foreground"
              title={metaTitle || undefined}>
              {isParsed ? (
                <span>
                  {props.stepCount} 步 · {inputCount} 输入
                </span>
              ) : null}
              {caps.hasCron || caps.hasWatch ? (
                <span>
                  {' · '}
                  {[caps.hasCron ? 'cron' : null, caps.hasWatch ? 'watch' : null]
                    .filter(Boolean)
                    .join('/')}
                </span>
              ) : null}
              {runs.failed > 0 ? (
                <span className="text-destructive"> · {runs.failed} 次失败</span>
              ) : null}
              {runs.lastAt ? (
                <span className="tabular-nums">
                  {' · '}
                  {formatRelativeTime(runs.lastAt, props.now)}
                </span>
              ) : null}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="relative z-10 h-8 w-8 shrink-0 cursor-pointer border-border/80 text-muted-foreground opacity-70 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive group-hover/card:opacity-100 focus-visible:opacity-100"
                    aria-label={`删除 ${entry.name}`}
                    title={`删除 ${entry.name}`}
                    onClick={handleDelete}>
                    <Icon
                      icon="mdi:trash-can-outline"
                      className="size-4"
                    />
                  </Button>
                }
              />
              <TooltipContent side="top">删除 {entry.name}</TooltipContent>
            </Tooltip>
            {isParsed ? (
              <WallRunBar
                name={entry.name}
                caps={caps}
                disabled={!isParsed}
                onOnce={function () {
                  props.onRun(entry.name)
                }}
              />
            ) : null}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-current={props.isActive}
        aria-label={`打开 ${entry.name}`}
        className="absolute inset-0 z-0 cursor-pointer rounded-[inherit] outline-none"
      />
    </div>
  )
}

export default memo(DirectiveCard, function (prev, next) {
  if (prev.entry !== next.entry) return false
  if (prev.isActive !== next.isActive) return false
  if (prev.stepCount !== next.stepCount) return false
  if (prev.runs !== next.runs) return false
  if (prev.onOpen !== next.onOpen) return false
  if (prev.onRun !== next.onRun) return false
  if (prev.onDelete !== next.onDelete) return false
  return prev.runs.lastAt === null || prev.now === next.now
})
