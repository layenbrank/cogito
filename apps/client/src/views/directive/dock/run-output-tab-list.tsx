import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { useCorexStore } from '@/stores/corex.ts'
import { RUN_STATUS_STYLES } from '@/views/directive/run/run-status.ts'

import type { RunSelection } from './use-run-selection.ts'

interface RunOutputTabListProps {
  tabs: RunSelection['tabs']
  selectedID: string | undefined
}

function RunOutputTabList(props: RunOutputTabListProps) {
  const focusRun = useCorexStore(function (state) {
    return state.focusRun
  })

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {props.tabs.map(function (run) {
        const style = RUN_STATUS_STYLES[run.status]
        const active = props.selectedID === run.id
        return (
          <Button
            variant="ghost"
            key={run.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`${run.name} · ${style.label}`}
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              'outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active
                ? 'bg-background font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
            )}
            onClick={function () {
              focusRun(run.id)
            }}>
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                style.dot,
                run.status === 'running' && 'animate-pulse'
              )}
            />
            {run.kind === 'trial' ? (
              <Icon
                icon="lucide:flask-conical"
                className="size-3 shrink-0 opacity-60"
                aria-hidden
              />
            ) : null}
            <span className="max-w-32 truncate">{run.name}</span>
          </Button>
        )
      })}
    </div>
  )
}

export { RunOutputTabList }
