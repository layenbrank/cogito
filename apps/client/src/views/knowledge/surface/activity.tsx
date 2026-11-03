/**
 * Ingest 活动队列：暂停/恢复、批量重试、blocked 态。
 */
import { Button } from '@cogito/design/components/button'
import { ScrollArea } from '@cogito/design/components/scroll-area'
import { useEffect } from 'react'

import { useFileSyncStore } from '@/views/knowledge/lib/file-sync-store.ts'
import { useIngestQueueStore } from '@/views/knowledge/lib/ingest-queue.ts'

function ActivityTab() {
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
  const runNext = useIngestQueueStore(function (state) {
    return state.runNext
  })
  const pause = useIngestQueueStore(function (state) {
    return state.pause
  })
  const resume = useIngestQueueStore(function (state) {
    return state.resume
  })
  const retryAllFailed = useIngestQueueStore(function (state) {
    return state.retryAllFailed
  })
  const unblockReady = useIngestQueueStore(function (state) {
    return state.unblockReady
  })
  const fileSyncTasks = useFileSyncStore(function (state) {
    return state.tasks
  })
  const ignoreFileSync = useFileSyncStore(function (state) {
    return state.ignore
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={isBusy || isPaused}
          onClick={function () {
            void runNext()
          }}>
          继续处理
        </Button>
        {isPaused ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={function () {
              resume()
            }}>
            恢复
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={function () {
              pause()
            }}>
            暂停
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={function () {
            retryAllFailed()
          }}>
          批量重试
        </Button>
        {blockedCount > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={function () {
              void unblockReady()
            }}>
            解除阻塞 ({blockedCount})
          </Button>
        ) : null}
        <span className="text-muted-foreground text-[11px]">
          {isPaused ? '已暂停 · ' : ''}
          {isBusy ? '处理中…' : `队列 ${items.length}`}
        </span>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {items.length === 0 && fileSyncTasks.length === 0 ? (
          <p className="text-muted-foreground px-1 py-2 text-xs">暂无 ingest / file-sync 任务</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {items.map(function (item) {
              return (
                <li
                  key={item.id}
                  className="rounded-md border border-border px-2 py-1.5 text-xs">
                  <p className="truncate font-medium">ingest · {item.path}</p>
                  <p className="text-muted-foreground">
                    {item.status}
                    {item.error ? ` · ${item.error}` : ''}
                  </p>
                  <div className="mt-1 flex gap-1">
                    {item.status === 'failed' ||
                    item.status === 'cancelled' ||
                    item.status === 'blocked' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px]"
                        onClick={function () {
                          retry(item.id)
                        }}>
                        重试
                      </Button>
                    ) : null}
                    {item.status === 'pending' ||
                    item.status === 'running' ||
                    item.status === 'blocked' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-1.5 text-[11px]"
                        onClick={function () {
                          cancel(item.id)
                        }}>
                        取消
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
            {fileSyncTasks.slice(0, 20).map(function (task) {
              return (
                <li
                  key={task.id}
                  className="rounded-md border border-border px-2 py-1.5 text-xs">
                  <p className="truncate font-medium">
                    sync · {task.kind} · {task.path}
                  </p>
                  <p className="text-muted-foreground">
                    {task.status}
                    {task.error ? ` · ${task.error}` : ''}
                  </p>
                  {task.status === 'failed' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-1 h-6 px-1.5 text-[11px]"
                      onClick={function () {
                        ignoreFileSync(task.id)
                      }}>
                      忽略
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

export { ActivityTab }
