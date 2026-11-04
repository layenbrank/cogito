/**
 * 左栏底条活动队列（唯一入口）：完整列表 + 批量重试。
 */
import { Button } from '@cogito/design/components/button'
import { cn } from 'cn'
import { useEffect } from 'react'

import { useFileSyncStore } from '@/views/knowledge/lib/file-sync-store.ts'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'

const STATUS_SHORT: Record<string, string> = {
  pending: '排队',
  running: '中',
  failed: '失败',
  blocked: '阻塞',
  cancelled: '取消',
  succeeded: '完成',
  skipped: '跳过'
}

function ActivityCompact() {
  const items = useIngestQueueStore(function (state) {
    return state.items
  })
  const isPaused = useIngestQueueStore(function (state) {
    return state.isPaused
  })
  const bootstrap = useIngestQueueStore(function (state) {
    return state.bootstrap
  })
  const cancel = useIngestQueueStore(function (state) {
    return state.cancel
  })
  const retry = useIngestQueueStore(function (state) {
    return state.retry
  })
  const retryAllFailed = useIngestQueueStore(function (state) {
    return state.retryAllFailed
  })
  const runNext = useIngestQueueStore(function (state) {
    return state.runNext
  })
  const pause = useIngestQueueStore(function (state) {
    return state.pause
  })
  const resume = useIngestQueueStore(function (state) {
    return state.resume
  })
  const unblockReady = useIngestQueueStore(function (state) {
    return state.unblockReady
  })
  const fileSyncTasks = useFileSyncStore(function (state) {
    return state.tasks
  })

  useEffect(
    function () {
      bootstrap()
      void unblockReady()
    },
    [bootstrap, unblockReady]
  )

  const isBusy = items.some(function (item) {
    return item.status === 'running'
  })
  const blockedCount = items.filter(function (item) {
    return item.status === 'blocked'
  }).length
  const failedCount = items.filter(function (item) {
    return item.status === 'failed'
  }).length

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="xs"
          variant="secondary"
          disabled={isBusy || isPaused}
          className="h-6 px-2 text-[11px]"
          onClick={function () {
            void runNext()
          }}>
          继续
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="h-6 px-2 text-[11px]"
          onClick={function () {
            if (isPaused) resume()
            else pause()
          }}>
          {isPaused ? '恢复' : '暂停'}
        </Button>
        {failedCount > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={retryAllFailed}>
            重试失败 {failedCount}
          </Button>
        ) : null}
        {blockedCount > 0 ? (
          <Button
            size="xs"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={function () {
              void unblockReady()
            }}>
            解阻 {blockedCount}
          </Button>
        ) : null}
        <span className="text-muted-foreground ml-auto text-[10px] tabular-nums">
          {isPaused ? '已暂停' : isBusy ? '处理中' : `${items.length} 项`}
        </span>
      </div>

      {items.length === 0 && fileSyncTasks.length === 0 ? (
        <p className="text-muted-foreground px-0.5 py-1 text-[11px] leading-snug">暂无任务</p>
      ) : (
        <ul className="max-h-40 min-h-0 space-y-0.5 overflow-y-auto overscroll-y-contain">
          {items.map(function (item) {
            return (
              <li
                key={item.id}
                className="bg-background/80 flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-1">
                <span
                  className={cn(
                    'shrink-0 rounded px-1 text-[10px] font-medium',
                    item.status === 'failed' || item.status === 'blocked'
                      ? 'bg-destructive/10 text-destructive'
                      : item.status === 'running' || item.status === 'pending'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-muted text-muted-foreground'
                  )}>
                  {STATUS_SHORT[item.status] ?? item.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px]">{item.path}</span>
                {item.status === 'failed' || item.status === 'blocked' ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] outline-none"
                    onClick={function () {
                      retry(item.id)
                    }}>
                    重试
                  </button>
                ) : null}
                {item.status === 'pending' ||
                item.status === 'running' ||
                item.status === 'blocked' ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] outline-none"
                    onClick={function () {
                      cancel(item.id)
                    }}>
                    取消
                  </button>
                ) : null}
              </li>
            )
          })}
          {fileSyncTasks.map(function (task) {
            return (
              <li
                key={task.id}
                className="text-muted-foreground truncate rounded-md border border-border/50 px-1.5 py-1 text-[10px]">
                sync · {task.kind} · {task.path}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { ActivityCompact }
