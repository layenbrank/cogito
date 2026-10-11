import { Button } from '@i-thinking/design/components/button'
import { Skeleton } from '@i-thinking/design/components/skeleton'
import { Icon } from '@iconify/react/offline'

import type { DirectiveEntry } from '@/shared/ipc/specs/sidecar'
import {
  EMPTY_RUNS,
  type DirectiveRuns
} from '@/views/directive/run/run-status'

import DirectiveCard from './directive-card'

interface LibraryGridProps {
  isLoading: boolean
  isLoaded: boolean
  loadError: string | null
  filteredCount: number
  groups: Map<string | null, DirectiveEntry[]>
  activeName?: string
  runSummaries: Record<string, DirectiveRuns>
  stepCounts: Record<string, number>
  now: number
  onRetry: () => void
  onOpen: (name: string) => void
  onRun: (name: string) => void
  onDelete: (name: string) => void
}

function LibraryGrid(props: LibraryGridProps) {
  return (
    <>
      {props.isLoading && !props.isLoaded ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : null}

      {props.loadError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">无法加载指令库</p>
          <p className="mt-1 text-muted-foreground">{props.loadError}</p>
          <Button
            size="sm"
            className="mt-3"
            variant="outline"
            onClick={props.onRetry}>
            重试
          </Button>
        </div>
      ) : null}

      {!props.loadError && props.isLoaded && props.filteredCount === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">还没有指令，点「新建」开始编排。</p>
      ) : null}

      {[...props.groups.entries()].map(function ([folder, entries]) {
        return (
          <div
            key={folder ?? '__root'}
            className="mb-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Icon
                icon="lucide:folder-open"
                className="size-3.5"
              />
              {folder ?? '未分组'}
              <span className="text-muted-foreground/70">{entries.length}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {entries.map(function (entry) {
                return (
                  <DirectiveCard
                    key={entry.name}
                    entry={entry}
                    isActive={props.activeName === entry.name}
                    runs={props.runSummaries[entry.name] ?? EMPTY_RUNS}
                    stepCount={props.stepCounts[entry.name] ?? 0}
                    now={props.now}
                    onOpen={props.onOpen}
                    onRun={props.onRun}
                    onDelete={props.onDelete}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </>
  )
}

export { LibraryGrid }
