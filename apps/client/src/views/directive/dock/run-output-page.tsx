/**
 * 「输出」页：顶部运行标签条 + 只读 xterm。
 * 并发运行时每个运行实例一页，切换标签即切换回显内容。
 */
import { TerminalOutputTab } from '@/features/terminal/terminal-output-tab'

import { RunOutputTabs } from './run-output-tabs.tsx'
import { useRunSelection } from './use-run-selection.ts'

interface RunOutputPageProps {
  active: boolean
}

function RunOutputPage(props: RunOutputPageProps) {
  const selection = useRunSelection()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RunOutputTabs selection={selection} />
      <div className="min-h-0 flex-1">
        <TerminalOutputTab
          active={props.active}
          runId={selection.selected?.id ?? null}
        />
      </div>
    </div>
  )
}

export { RunOutputPage }
