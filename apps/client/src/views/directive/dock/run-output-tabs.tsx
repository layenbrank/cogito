/**
 * 输出页签条：一个运行实例一页，点标签把焦点挪过去。
 * 右侧固定显示当前选中运行的状态 / 步数 / 用时，运行中可取消。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { useCorexStore } from '@/stores/corex.ts'
import { RUN_STATUS_STYLES, formatElapsed } from '@/views/directive/run/run-status.ts'
import { useNow } from '@/views/directive/use-now.ts'

import type { RunSelection } from './use-run-selection.ts'

interface RunOutputTabsProps {
  selection: RunSelection
}

function RunOutputTabs(props: RunOutputTabsProps) {
  const isSelectedRunning = props.selection.selected?.status === 'running'
  const focusRun = useCorexStore(function (state) {
    return state.focusRun
  })
  const cancelRun = useCorexStore(function (state) {
    return state.cancelRun
  })
  const clearRuns = useCorexStore(function (state) {
    return state.clearRuns
  })
  const now = useNow(1000, isSelectedRunning)

  const { tabs, selected, stepCount } = props.selection
  if (tabs.length === 0) return null

  const selectedStyle = selected ? RUN_STATUS_STYLES[selected.status] : null
  const progress = selected
    ? stepCount > 0
      ? Math.min(100, (selected.doneSteps / stepCount) * 100)
      : selected.status === 'ok'
        ? 100
        : selected.status === 'running'
          ? 8
          : 0
    : 0
  const hasFinished = tabs.some(function (run) {
    return run.status !== 'running'
  })

  return (
    <>
      <div
        role="tablist"
        aria-label="运行输出"
        className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-muted px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map(function (run) {
            const style = RUN_STATUS_STYLES[run.status]
            const active = selected?.id === run.id
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
        {selected && selectedStyle ? (
          <div className="flex shrink-0 items-center gap-1.5 border-l pl-2 text-[11px]">
            <span className={cn('font-medium', selectedStyle.tone)}>{selectedStyle.label}</span>
            {stepCount > 0 ? (
              <span className="font-mono text-muted-foreground tabular-nums">
                {selected.doneSteps}/{stepCount}
              </span>
            ) : null}
            <span className="font-mono text-muted-foreground tabular-nums">
              {formatElapsed(selected, now)}
            </span>
            {selected.status === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-xs"
                onClick={function () {
                  void cancelRun(selected.id)
                }}>
                取消
              </Button>
            ) : null}
            {hasFinished ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="清空已结束的运行"
                title="清空已结束的运行"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={function () {
                  clearRuns()
                }}>
                <Icon
                  icon="lucide:eraser"
                  className="size-3.5"
                />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {selected?.status === 'running' ? (
        <div className="h-0.5 shrink-0 bg-muted">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </>
  )
}

export { RunOutputTabs }
