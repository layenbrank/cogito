import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { clsx } from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import { refreshNow, useWorkspaceGitSnapshot } from '@/features/agent/workspace/git.ts'
import { useWorkspaceRevision } from '@/features/agent/workspace/revision.ts'
import { WorkspaceGit, type CommitHit, type ShowFile } from '@/lib/workspace-git'
import { AsideDiff } from '@/views/agent/chat/components/aside-diff'
import {
  ASIDE_PATH_TRIGGER,
  buildAsidePathMenuItems,
  findAsidePathAttrs,
  toastAttached
} from '@/views/agent/chat/components/aside-path-menu'
import {
  findReviewBaseName,
  findReviewParentLabel
} from '@/views/agent/chat/components/aside-review-rows'
import { WorkspaceFolderChips } from '@/views/agent/chat/components/workspace-folder-chips'
import {
  buildFolderLabels,
  findFolderLabel
} from '@/views/agent/chat/components/workspace-relative-path.ts'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'

interface HistoryDiffTarget {
  relative: string
  oid: string
  short: string
  parentOid: string | null
}

const RECENT_LIMIT = 50

const STATUS_STYLE: Record<string, string> = {
  M: 'text-amber-600 dark:text-amber-400',
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  U: 'text-destructive',
  '?': 'text-muted-foreground'
}

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
  const aui = useAui()
  const { rootPath, primaryRootPath, folders } = useActiveWorkspace()
  /** 与审阅共用同一份快照：分支名要一致，也顺便知道这个文件夹到底是不是仓库 */
  const snapshot = useWorkspaceGitSnapshot(rootPath)
  const revision = useWorkspaceRevision()
  const [commits, updateCommits] = useState<CommitHit[]>([])
  const [isPending, updatePending] = useState(false)
  const [error, updateError] = useState<string | null>(null)
  const [expandedOid, updateExpandedOid] = useState<string | null>(null)
  const [files, updateFiles] = useState<ShowFile[]>([])
  /** 展开的提交正在读文件：别拿「文件数为 0」当加载态，否则空提交会一直转圈 */
  const [isFilesPending, updateFilesPending] = useState(false)
  const [diffTarget, updateDiffTarget] = useState<HistoryDiffTarget | null>(null)
  /** 展开中的 oid；异步回来时用它判断用户是不是已经切走了 */
  const expandedRef = useRef<string | null>(null)

  useEffect(
    function () {
      if (!rootPath) {
        updateCommits([])
        updatePending(false)
        updateError(null)
        return
      }
      let cancelled = false
      updatePending(true)
      updateError(null)
      WorkspaceGit.search(rootPath, { query: '', field: 'all', limit: RECENT_LIMIT })
        .then(function (result) {
          if (cancelled) return
          updateCommits(result.commits)
          // 换分支 / reset 之后，展开的那个提交可能已经不在了：别留着它的文件列表
          if (
            expandedRef.current &&
            !result.commits.some(function (item) {
              return item.oid === expandedRef.current
            })
          ) {
            setExpanded(null, [])
          }
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
    [rootPath, revision]
  )

  function toggleCommit(oid: string) {
    if (expandedOid === oid) {
      setExpanded(null, [])
      return
    }
    setExpanded(oid, [])
    if (!rootPath) return
    updateFilesPending(true)
    void WorkspaceGit.show(rootPath, oid)
      .then(function (result) {
        setFilesFor(oid, result.files)
      })
      .catch(function (cause: unknown) {
        console.warn('[agent/aside-history] 读取提交内容失败:', cause)
        setFilesFor(oid, [])
      })
      .finally(function () {
        if (expandedRef.current === oid) updateFilesPending(false)
      })
  }

  function setExpanded(oid: string | null, nextFiles: ShowFile[]) {
    expandedRef.current = oid
    updateExpandedOid(oid)
    updateFiles(nextFiles)
    updateFilesPending(false)
  }

  /** 只在展开的还是同一个提交时写入，避免慢请求覆盖用户后续的点击 */
  function setFilesFor(oid: string, nextFiles: ShowFile[]) {
    if (expandedRef.current === oid) updateFiles(nextFiles)
  }

  /** 右键菜单给的是引用路径（主文件夹相对 / 其他文件夹绝对），直接挂 */
  const attachReference = useCallback(
    function (reference: string) {
      void attachWorkspaceFile(aui, reference)
        .then(function () {
          toastAttached(reference)
        })
        .catch(function (cause: unknown) {
          toast.error(cause instanceof Error ? cause.message : '引用失败')
        })
    },
    [aui]
  )

  const findPathMenuItems = useCallback(
    function (trigger: Element) {
      if (!rootPath) return []
      const attrs = findAsidePathAttrs(trigger)
      if (!attrs) return []
      return buildAsidePathMenuItems({
        rootPath,
        agentRoot: primaryRootPath,
        relative: attrs.relative,
        onAddToComposer: attachReference
      })
    },
    [rootPath, primaryRootPath, attachReference]
  )

  function openFileDiff(commit: CommitHit, relative: string) {
    updateDiffTarget({
      relative,
      oid: commit.oid,
      short: commit.short,
      parentOid: commit.parentOid
    })
  }

  if (!rootPath) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center p-4 text-center text-xs">
        先在左栏添加一个工作区
      </div>
    )
  }

  /** 多文件夹可能同名（两个 api）：靠上一级目录区分，和顶部 chips 一致 */
  const folderName = findFolderLabel(
    buildFolderLabels(
      folders.map(function (folder) {
        return folder.path
      })
    ),
    rootPath
  )
  /** 快照还在读时先别下「不是仓库」的结论，否则会闪一下错误结论 */
  const isEmpty = !isPending && !error && !snapshot.isPending && commits.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 多根工作区：切文件夹与审阅共用同一个「当前文件夹」 */}
      <div className="border-border flex shrink-0 flex-col border-b">
        <WorkspaceFolderChips />
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
            <Icon
              icon="lucide:history"
              className="size-3.5 shrink-0"
            />
            <span className="text-foreground shrink-0 font-medium">提交历史</span>
            <span
              className="truncate opacity-70"
              title={rootPath}>
              · {folderName}
            </span>
            {snapshot.branch ? (
              <span
                className="bg-muted text-foreground/80 flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5"
                title={`当前分支 ${snapshot.branch}（与审阅同一份快照）`}>
                <Icon
                  icon="lucide:git-branch"
                  className="size-3 shrink-0"
                />
                <span className="max-w-24 truncate font-mono">{snapshot.branch}</span>
              </span>
            ) : null}
            {commits.length > 0 ? (
              <span className="bg-muted shrink-0 rounded-full px-1.5 py-0.5 tabular-nums">
                {commits.length}
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="刷新提交历史"
            title="刷新：清掉 Git 指纹缓存后重读当前文件夹（与审阅同一个刷新）"
            className="text-muted-foreground hover:text-foreground size-6 shrink-0"
            disabled={isPending}
            onClick={function () {
              void refreshNow(rootPath)
            }}>
            <Icon
              icon="lucide:refresh-cw"
              className={clsx('size-3.5', isPending && 'animate-spin')}
            />
          </Button>
        </div>
      </div>

      {diffTarget ? (
        <AsideDiff
          rootPath={rootPath}
          relative={diffTarget.relative}
          revs={{
            oldOid: diffTarget.parentOid ?? '',
            newOid: diffTarget.oid
          }}
          label={`${diffTarget.parentOid ? diffTarget.parentOid.slice(0, 7) : '∅'} ↔ ${diffTarget.short}`}
          onBack={function () {
            updateDiffTarget(null)
          }}
        />
      ) : (
        <ContextMenu
          trigger={ASIDE_PATH_TRIGGER}
          classNames={CODE_MENU_CLASS_NAMES}
          findItems={findPathMenuItems}>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
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

            {isEmpty ? (
              <p className="text-muted-foreground p-3 text-xs">
                {snapshot.isRepo
                  ? `${folderName} 还没有提交`
                  : `${folderName} 不是 Git 仓库，没有提交历史`}
              </p>
            ) : null}

            {commits.length > 0 ? (
              <ul className="flex flex-col">
                {commits.map(function (commit) {
                  const isExpanded = commit.oid === expandedOid
                  return (
                    <li
                      key={commit.oid}
                      className={clsx(isExpanded && 'bg-muted/25')}>
                      <button
                        type="button"
                        title={commit.subject || '(无说明)'}
                        aria-expanded={isExpanded}
                        onClick={function () {
                          toggleCommit(commit.oid)
                        }}
                        className={clsx(
                          'hover:bg-muted/60 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors',
                          isExpanded &&
                            'bg-background/95 sticky top-0 z-10 border-b border-border/80 shadow-sm backdrop-blur-sm'
                        )}>
                        <Icon
                          icon={commit.isHead ? 'lucide:home' : 'lucide:git-commit-vertical'}
                          className={clsx(
                            'mt-0.5 size-3.5 shrink-0',
                            commit.isHead ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-foreground line-clamp-2 text-[13px] leading-snug font-medium">
                            {commit.subject || '(无说明)'}
                          </span>
                          <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
                            <span className="truncate">{commit.authorName}</span>
                            <span className="opacity-40">·</span>
                            <span className="shrink-0">
                              {formatRelativeTime(commit.committedAt)}
                            </span>
                            <span className="text-foreground/65 ml-auto shrink-0 font-mono text-xs tabular-nums">
                              {commit.short}
                            </span>
                          </span>
                        </span>
                      </button>

                      {isExpanded ? (
                        <ul className="flex flex-col gap-0.5 px-2 pt-1.5 pb-2.5">
                          {files.length === 0 ? (
                            <li className="text-muted-foreground px-2 py-1.5 text-xs">
                              {isFilesPending ? '读取中…' : '这个提交没有改动文件'}
                            </li>
                          ) : (
                            files.map(function (file) {
                              const letter = findStatusLetter(file.status)
                              const parent = findReviewParentLabel(file.path)
                              return (
                                <li key={file.path}>
                                  <button
                                    type="button"
                                    data-aside-path={file.path}
                                    data-aside-kind="file"
                                    title={`查看 ${file.path} 的变更`}
                                    onClick={function () {
                                      openFileDiff(commit, file.path)
                                    }}
                                    className="hover:bg-muted/70 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors">
                                    <span
                                      className={clsx(
                                        'w-3.5 shrink-0 text-center font-mono text-xs font-semibold',
                                        STATUS_STYLE[letter] ?? 'text-muted-foreground'
                                      )}>
                                      {letter}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="text-foreground block truncate text-[13px] leading-snug">
                                        {findReviewBaseName(file.path)}
                                      </span>
                                      {parent ? (
                                        <span className="text-muted-foreground block truncate text-xs opacity-70">
                                          {parent}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
                                      {file.added !== null && file.added > 0 ? (
                                        <span className="text-emerald-600 dark:text-emerald-400">
                                          +{file.added}
                                        </span>
                                      ) : null}
                                      {file.deleted !== null && file.deleted > 0 ? (
                                        <span className="text-destructive">-{file.deleted}</span>
                                      ) : null}
                                    </span>
                                  </button>
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
        </ContextMenu>
      )}
    </div>
  )
}

export { AsideHistory }
