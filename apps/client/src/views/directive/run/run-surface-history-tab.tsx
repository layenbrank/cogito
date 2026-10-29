import { Badge } from '@cogito/design/components/badge'
import { ScrollArea } from '@cogito/design/components/scroll-area'

import type { ListRunsReply } from '@/lib/directive-ipc.ts'

interface RunSurfaceHistoryTabProps {
  runHistory: ListRunsReply | null
}

function RunSurfaceHistoryTab(props: RunSurfaceHistoryTabProps) {
  if (!props.runHistory?.is_history_enabled) {
    return <p className="py-2 text-sm text-muted-foreground">运行历史未启用。</p>
  }

  return (
    <ScrollArea className="h-full">
      <ul className="space-y-1 py-1 text-xs">
        {props.runHistory.entries.map(function (entry) {
          return (
            <li
              key={String(entry.started_at_ms)}
              className="rounded border px-2 py-1">
              <span className="font-medium">{entry.directive}</span>
              <Badge
                className="ml-2"
                variant={entry.ok ? 'success' : 'destructive'}>
                {entry.ok ? '成功' : '失败'}
              </Badge>
              <span className="ml-2 text-muted-foreground">{entry.duration_ms}ms</span>
              {entry.error ? <p className="text-destructive">{entry.error}</p> : null}
            </li>
          )
        })}
      </ul>
    </ScrollArea>
  )
}

export { RunSurfaceHistoryTab }
