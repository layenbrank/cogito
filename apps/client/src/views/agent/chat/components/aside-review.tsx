/**
 * 右栏审阅：工作区未提交变更列表 + 点选对比。
 *
 * 清单以 `git status` 为准，并合并本会话写文件工具触及的路径
 * （尚未落盘到 git 感知范围时也能点进去看）。
 */
import { Icon } from '@iconify/react/offline'
import { useAuiState } from '@assistant-ui/react'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'

import { collectToolPaths } from '@/features/agent/tool-paths.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { WorkspaceGit, type StatusEntry } from '@/lib/workspace-git'
import { findStatusBadge, groupEntries } from '@/views/code/lib/git-status.ts'
import { AsideDiff } from '@/views/agent/chat/components/aside-diff'

interface AsideReviewProps {
  initialRelative?: string | null
}

interface ReviewRow {
  path: string
  badge: string | null
  source: 'git' | 'tool'
}

const BADGE_STYLE: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  U: 'text-destructive',
  '?': 'text-muted-foreground'
}

function findBaseName(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function findParentLabel(relative: string) {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? '' : relative.slice(0, slash)
}

function AsideReview(props: AsideReviewProps) {
  const { primaryPath } = useActiveWorkspace()
  const messages = useAuiState(function (state) {
    return state.thread.messages
  })
  const isRunning = useAuiState(function (state) {
    return state.thread.isRunning
  })
  const wasRunning = useRef(isRunning)

  const [entriesState, updateEntries] = useState<StatusEntry[]>([])
  const [isPending, updatePending] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [isRepoState, updateIsRepo] = useState(true)
  const [selected, updateSelected] = useState<string | null>(props.initialRelative ?? null)
  const [seenInitial, updateSeenInitial] = useState(props.initialRelative ?? null)
  const [refreshKey, updateRefreshKey] = useState(0)

  // 外部指定焦点文件时在渲染期同步（React 推荐写法），不进 effect
  if (props.initialRelative !== seenInitial) {
    updateSeenInitial(props.initialRelative ?? null)
    updateSelected(props.initialRelative ?? null)
  }

  /** 没有工作区时按空列表渲染：不在 effect 里同步清 state */
  const isRepo = primaryPath ? isRepoState : false

  const toolHits = useMemo(
    function () {
      return collectToolPaths(messages, primaryPath)
    },
    [messages, primaryPath]
  )

  useEffect(
    function () {
      if (!primaryPath) return

      let cancelled = false

      async function load() {
        try {
          updatePending(true)
          updateError(null)
          const probe = await WorkspaceGit.probe(primaryPath as string)
          if (cancelled) return
          updateIsRepo(probe.isRepo)
          if (!probe.isRepo) {
            updateEntries([])
            return
          }
          const status = await WorkspaceGit.status(primaryPath as string)
          if (cancelled) return
          updateEntries(status.entries)
        } catch (cause) {
          console.warn('[agent/aside-review] 读取变更失败:', cause)
          if (!cancelled) {
            updateError(cause instanceof Error ? cause.message : '读取变更失败')
            updateEntries([])
          }
        } finally {
          if (!cancelled) updatePending(false)
        }
      }

      void load()

      return function () {
        cancelled = true
      }
    },
    [primaryPath, refreshKey]
  )

  // 跑完一轮后再刷一次，把刚写的文件收进来
  useEffect(
    function () {
      if (wasRunning.current && !isRunning) {
        updateRefreshKey(function (value) {
          return value + 1
        })
      }
      wasRunning.current = isRunning
    },
    [isRunning]
  )

  const rows = useMemo(
    function () {
      const entries = primaryPath ? entriesState : []
      const groups = groupEntries(entries)
      const fromGit = new Map<string, ReviewRow>()
      for (const entry of [...groups.staged, ...groups.changed, ...groups.untracked]) {
        if (fromGit.has(entry.path)) continue
        fromGit.set(entry.path, {
          path: entry.path,
          badge: findStatusBadge(entry),
          source: 'git'
        })
      }

      const merged: ReviewRow[] = [...fromGit.values()]
      for (const hit of toolHits) {
        if (fromGit.has(hit.path)) continue
        merged.push({ path: hit.path, badge: null, source: 'tool' })
      }
      return merged
    },
    [primaryPath, entriesState, toolHits]
  )

  if (!primaryPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  if (selected) {
    return (
      <AsideDiff
        rootPath={primaryPath}
        relative={selected}
        onBack={function () {
          updateSelected(null)
        }}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="border-border flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <Icon
            icon="lucide:git-compare"
            className="size-3.5 shrink-0"
          />
          <span className="truncate">未提交变更</span>
          {rows.length > 0 ? (
            <Badge
              variant="secondary"
              className="h-5 px-1.5 text-[10px]">
              {rows.length}
            </Badge>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="刷新变更"
          title="刷新"
          className="size-6"
          disabled={isPending}
          onClick={function () {
            updateRefreshKey(function (value) {
              return value + 1
            })
          }}>
          <Icon
            icon="lucide:refresh-cw"
            className={clsx('size-3.5', isPending && 'animate-spin')}
          />
        </Button>
      </div>

      {isPending && rows.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
          <Icon
            icon="lucide:loader-circle"
            className="size-3.5 animate-spin"
          />
          读取中…
        </p>
      ) : null}

      {error ? <p className="text-destructive p-3 text-xs">{error}</p> : null}

      {!isPending && !error && !isRepo ? (
        <p className="text-muted-foreground p-3 text-xs">
          当前工作区不是 Git 仓库。仍可从下方「本会话改动」打开文件对比。
        </p>
      ) : null}

      {!isPending && !error && isRepo && rows.length === 0 ? (
        <p className="text-muted-foreground p-3 text-xs">暂无未提交变更</p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-0.5 p-1.5">
          {rows.map(function (row) {
            const parent = findParentLabel(row.path)
            return (
              <li key={row.path}>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-1.5 px-2 py-1.5 text-xs font-normal"
                  onClick={function () {
                    updateSelected(row.path)
                  }}>
                  <span
                    className={clsx(
                      'w-3 shrink-0 text-center font-mono text-[11px]',
                      row.badge ? BADGE_STYLE[row.badge] : 'text-muted-foreground'
                    )}>
                    {row.badge ?? '·'}
                  </span>
                  <span className="text-foreground min-w-0 truncate">{findBaseName(row.path)}</span>
                  {parent ? (
                    <span className="text-muted-foreground min-w-0 truncate text-[11px] opacity-70">
                      {parent}
                    </span>
                  ) : null}
                  {row.source === 'tool' ? (
                    <span className="text-muted-foreground ml-auto shrink-0 text-[10px]">会话</span>
                  ) : null}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export { AsideReview }
