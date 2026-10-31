/**
 * 右栏提交历史：最近提交列表 + 展开看本次改动的文件。
 *
 * 数据与 code 视图同一套 IPC（`WorkspaceGit.search` / `show`），
 * 但根目录取 agent 的当前工作区，不读 code 视图的 repoRoot。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useEffect, useRef, useState } from 'react'

import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { WorkspaceGit, type CommitHit, type ShowFile } from '@/lib/workspace-git'

const RECENT_LIMIT = 50

function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`
  const date = new Date(unixSeconds * 1000)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function findStatusLetter(status: string) {
  const letter = status.trim().charAt(0).toUpperCase()
  return letter || '?'
}

function AsideHistory() {
  const { rootPath } = useActiveWorkspace()
  const revision = useWorkspaceRevision()
  const [commits, updateCommits] = useState<CommitHit[]>([])
  const [isPending, updatePending] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [refreshKey, updateRefreshKey] = useState(0)
  const [expandedOid, updateExpandedOid] = useState<string | null>(null)
  const [files, updateFiles] = useState<ShowFile[]>([])
  /** 展开中的 oid；异步回来时用它判断用户是不是已经切走了 */
  const expandedRef = useRef<string | null>(null)

  useEffect(
    function () {
      if (!rootPath) return
      let cancelled = false
      updatePending(true)
      updateError(null)
      WorkspaceGit.search(rootPath, { query: '', field: 'all', limit: RECENT_LIMIT })
        .then(function (result) {
          if (!cancelled) updateCommits(result.commits)
        })
        .catch(function (cause: unknown) {
          console.warn('[agent/aside-history] 读取提交历史失败:', cause)
          if (!cancelled) {
            updateError(cause instanceof Error ? cause.message : '读取提交历史失败')
            updateCommits([])
          }
        })
        .finally(function () {
          if (!cancelled) updatePending(false)
        })
      return function () {
        cancelled = true
      }
    },
    [rootPath, refreshKey, revision]
  )

  function toggleCommit(oid: string) {
    if (expandedOid === oid) {
      setExpanded(null, [])
      return
    }
    setExpanded(oid, [])
    if (!rootPath) return
    void WorkspaceGit.show(rootPath, oid)
      .then(function (result) {
        setFilesFor(oid, result.files)
      })
      .catch(function (cause: unknown) {
        console.warn('[agent/aside-history] 读取提交内容失败:', cause)
        setFilesFor(oid, [])
      })
  }

  function setExpanded(oid: string | null, nextFiles: ShowFile[]) {
    expandedRef.current = oid
    updateExpandedOid(oid)
    updateFiles(nextFiles)
  }

  /** 只在展开的还是同一个提交时写入，避免慢请求覆盖用户后续的点击 */
  function setFilesFor(oid: string, nextFiles: ShowFile[]) {
    if (expandedRef.current === oid) updateFiles(nextFiles)
  }

  if (!rootPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
          <Icon
            icon="lucide:git-commit-horizontal"
            className="size-3.5 shrink-0"
          />
          <span className="truncate">提交历史</span>
          {commits.length > 0 ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5 text-xs tabular-nums">
              {commits.length}
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新提交历史"
          title="刷新"
          className="text-muted-foreground hover:text-foreground size-6 shrink-0"
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending && commits.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 p-3 text-xs">
            <Icon
              icon="lucide:loader-circle"
              className="size-3.5 animate-spin"
            />
            读取中…
          </p>
        ) : null}

        {error ? <p className="text-destructive p-3 text-xs">{error}</p> : null}

        {!isPending && !error && commits.length === 0 ? (
          <p className="text-muted-foreground p-3 text-xs">还没有提交，或当前工作区不是 Git 仓库</p>
        ) : null}

        {commits.length > 0 ? (
          <ul className="flex flex-col">
            {commits.map(function (commit) {
              const isExpanded = commit.oid === expandedOid
              return (
                <li key={commit.oid}>
                  <button
                    type="button"
                    title={commit.subject || '(无说明)'}
                    aria-expanded={isExpanded}
                    onClick={function () {
                      toggleCommit(commit.oid)
                    }}
                    className={clsx(
                      'hover:bg-muted/60 flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
                      isExpanded && 'bg-muted/40'
                    )}>
                    <Icon
                      icon={commit.isHead ? 'lucide:home' : 'lucide:git-commit-vertical'}
                      className={clsx(
                        'mt-0.5 size-3.5 shrink-0',
                        commit.isHead ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-foreground line-clamp-1 text-xs font-medium">
                        {commit.subject || '(无说明)'}
                      </span>
                      <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="truncate">{commit.authorName}</span>
                        <span className="opacity-40">·</span>
                        <span className="shrink-0">{formatRelativeTime(commit.committedAt)}</span>
                        <span className="text-foreground/70 ml-auto shrink-0 font-mono text-xs tabular-nums">
                          {commit.short}
                        </span>
                      </span>
                    </span>
                  </button>

                  {isExpanded ? (
                    <ul className="bg-muted/20 flex flex-col gap-0.5 px-3 pt-1 pb-2">
                      {files.length === 0 ? (
                        <li className="text-muted-foreground text-xs">读取中…</li>
                      ) : (
                        files.map(function (file) {
                          return (
                            <li
                              key={file.path}
                              className="flex items-center gap-1.5 text-xs"
                              title={file.path}>
                              <span className="text-muted-foreground w-3 shrink-0 font-mono font-semibold">
                                {findStatusLetter(file.status)}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-mono">
                                {file.path}
                              </span>
                              {file.added !== null && file.added > 0 ? (
                                <span className="shrink-0 font-mono text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
                                  +{file.added}
                                </span>
                              ) : null}
                              {file.deleted !== null && file.deleted > 0 ? (
                                <span className="text-destructive shrink-0 font-mono text-xs tabular-nums">
                                  -{file.deleted}
                                </span>
                              ) : null}
                            </li>
                          )
                        })
                      )}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}

export { AsideHistory }
