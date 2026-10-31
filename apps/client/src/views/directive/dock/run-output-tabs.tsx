/**
 * 输出页签条：一个运行实例一页，点标签把焦点挪过去。
 * 右侧固定显示当前选中运行的状态 / 步数 / 用时，运行中可取消。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'

import { useCorexStore } from '@/stores/corex.ts'
import { RUN_STATUS_STYLES, formatElapsed } from '@/views/directive/run/run-status.ts'
import { RunOutputTabList } from '@/views/directive/dock/run-output-tab-list.tsx'
import { findRunProgress } from '@/views/directive/dock/run-output-status.ts'
import { useNow } from '@/views/directive/use-now.ts'

import type { RunSelection } from './use-run-selection.ts'

interface RunOutputTabsProps {
  selection: RunSelection
}

function RunOutputTabs(props: RunOutputTabsProps) {
  const isSelectedRunning = props.selection.selected?.status === 'running'
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
  const progress = findRunProgress(selected, stepCount)
  const hasFinished = tabs.some(function (run) {
    return run.status !== 'running'
  })

  return (
    <>
      <div
        role="tablist"
        aria-label="运行输出"
        className="flex h-8 shrink-0 items-center gap-1 border-b border-border bg-muted px-1.5">
        <RunOutputTabList
          tabs={tabs}
          selectedID={selected?.id}
        />
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
