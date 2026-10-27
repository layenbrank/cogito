import { Icon } from '@iconify/react/offline'
import { cn } from 'cn'
import { memo } from 'react'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'

import { findBucketMark } from './bucket'
import { CardFooter } from './card-footer.tsx'
import { CardStatus } from './card-status.tsx'
import type { DirectiveRuns } from '@/views/directive/run/run-status'

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

function Card(props: Props) {
  const { entry } = props
  const isParsed = entry.summary !== null
  const mark = findBucketMark(entry.bucket)
  const description = entry.summary?.description ?? ''

  return (
    <div
      className={cn(
        'group/card relative flex w-full min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-card p-3 shadow-xs',
        'transition-[border-color,background-color,box-shadow] duration-200',
        'active:bg-accent-active',
        'has-focus-visible:ring-2 has-focus-visible:ring-ring/50',
        props.isActive
          ? 'border-primary bg-accent text-accent-foreground shadow-sm'
          : 'border-border hover:border-border hover:bg-accent-hover hover:shadow-sm'
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
              <CardStatus
                isParsed={isParsed}
                runs={props.runs}
              />
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

        <CardFooter
          entry={entry}
          isParsed={isParsed}
          runs={props.runs}
          stepCount={props.stepCount}
          now={props.now}
          onRun={props.onRun}
          onDelete={props.onDelete}
        />
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

export default memo(Card, function (prev, next) {
  if (prev.entry !== next.entry) return false
  if (prev.isActive !== next.isActive) return false
  if (prev.stepCount !== next.stepCount) return false
  if (prev.runs !== next.runs) return false
  if (prev.onOpen !== next.onOpen) return false
  if (prev.onRun !== next.onRun) return false
  if (prev.onDelete !== next.onDelete) return false
  return prev.runs.lastAt === null || prev.now === next.now
})
