/**
 * 右栏「历史」：提交列表 + 展开看改动文件 + 逐文件对比。
 *
 * 2026-11 重做要点：
 * - **本地 / 远端一眼分清**：默认按「本地未推送 → 更早提交」分组，本地那组用琥珀色导轨，
 *   行内也带「本地」标签；顶部还有「全部 / 仅本地」分段筛选。以前只有一个小圆角标签，
 *   扫一眼根本分不出来。
 * - **与文件树同一套骨架**：顶部是文件夹切换条 + 一条工具栏（分支选择器 / 搜索 / 刷新），
 *   行高、字号、圆角、次级文字与文件树 / 审阅保持一致，三个面板不再各长一套。
 * - **能搜**：提交多了以后靠滚动找是折磨，直接走 `WorkspaceGit.search` 的 query。
 */
import { useAui } from '@assistant-ui/react'
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { clsx } from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { ContextMenu } from '@/components/contextmenu'
import { attachWorkspaceFile } from '@/features/agent/attachment.ts'
import { useActiveWorkspace } from '@/features/agent/workspace/active.ts'
import {
  checkoutNow,
  refreshNow,
  useWorkspaceGitSnapshot
} from '@/features/agent/workspace/git.ts'
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
import { BranchSwitcherView } from '@/views/code/workspace/scm/branch-switcher-view.tsx'
import { CODE_MENU_CLASS_NAMES } from '@/views/code/lib/context-menu.ts'

interface HistoryDiffTarget {
  relative: string
  oid: string
  short: string
  parentOid: string | null
}

const RECENT_LIMIT = 50
const SEARCH_DEBOUNCE_MS = 220

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

/** 分组标题：与审阅的分区标题同一档字号与节奏 */
function GroupHeader(props: { icon: string; label: string; count: number; tone: 'local' | 'remote' }) {
  return (
    <div
      className={clsx(
        'sticky top-0 z-10 flex h-8 items-center gap-1.5 border-b px-2.5 text-xs font-semibold backdrop-blur-sm',
        props.tone === 'local'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
          : 'border-border/60 bg-muted/45 text-muted-foreground'
      )}>
      <Icon
        icon={props.icon}
        className="size-3.5 shrink-0"
      />
      <span>{props.label}</span>
      <span
        className={clsx(
          'ms-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums',
          props.tone === 'local'
            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
            : 'bg-muted text-muted-foreground'
        )}>
        {props.count}
      </span>
    </div>
  )
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
  /** 本地 / 远端过滤：`local` 只看还没推上去的提交 */
  const [scope, updateScope] = useState<'all' | 'local'>('all')
  const [query, updateQuery] = useState('')
  const [debouncedQuery, updateDebouncedQuery] = useState('')
  /** 展开中的 oid；异步回来时用它判断用户是不是已经切走了 */
  const expandedRef = useRef<string | null>(null)

  useEffect(
    function () {
      const timer = window.setTimeout(function () {
        updateDebouncedQuery(query.trim())
      }, SEARCH_DEBOUNCE_MS)
      return function () {
        window.clearTimeout(timer)
      }
    },
    [query]
  )

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
      WorkspaceGit.search(rootPath, {
        query: debouncedQuery,
        field: 'all',
        limit: RECENT_LIMIT
      })
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
    [rootPath, revision, debouncedQuery]
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
  /**
   * 「本地未推送」= 上游分支没有的最新提交。
   *
   * 线性历史下就是最前面的 `ahead` 条（`git status` 的 ahead 计数同源）；
   * merge 提交会让这个近似略微偏移，但比「再查一遍 ahead 的 oid 列表」便宜得多。
   */
  const localCount = Math.min(Math.max(snapshot.ahead, 0), commits.length)
  const rows = commits.map(function (commit, index) {
    return { commit, isLocal: index < localCount }
  })
  const visibleRows = rows.filter(function (entry) {
    return scope === 'all' || entry.isLocal
  })
  const localRows = visibleRows.filter(function (entry) {
    return entry.isLocal
  })
  const restRows = visibleRows.filter(function (entry) {
    return !entry.isLocal
  })

  /** 一条提交：行高 / 字号与文件树、审阅列表同一套 */
  function renderCommit(entry: { commit: CommitHit; isLocal: boolean }) {
    const commit = entry.commit
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
            'hover:bg-muted/60 relative flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors',
            entry.isLocal && 'before:bg-amber-500/70 before:absolute before:inset-y-1.5 before:start-0 before:w-0.5 before:rounded-full'
          )}>
          <Icon
            icon={isExpanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
            className="text-muted-foreground mt-0.5 size-3.5 shrink-0"
          />
          <span className="min-w-0 flex-1">
            <span className="text-foreground line-clamp-2 text-[13px] leading-snug font-medium">
              {commit.subject || '(无说明)'}
            </span>
            <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
              {commit.isHead ? (
                <span className="bg-primary/10 text-primary rounded px-1 text-[10px] leading-4">
                  HEAD
                </span>
              ) : null}
              {entry.isLocal ? (
                <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] leading-4 font-medium text-amber-700 dark:text-amber-300">
                  本地
                </span>
              ) : null}
              <span className="truncate">{commit.authorName}</span>
              <span className="opacity-40">·</span>
              <span className="shrink-0">{formatRelativeTime(commit.committedAt)}</span>
              <span className="text-foreground/60 ms-auto shrink-0 font-mono tabular-nums">
                {commit.short}
              </span>
            </span>
          </span>
        </button>

        {isExpanded ? (
          <ul className="flex flex-col gap-0.5 pb-2.5 ps-4 pe-2">
            {files.length === 0 ? (
              <li className="text-muted-foreground px-2 py-1.5 text-xs">
                {isFilesPending ? '读取中…' : '这个提交没有改动文件'}
              </li>
            ) : (
              files.map(function (file) {
                const letter = findStatusLetter(file.status)
                const parent = findReviewParentLabel(file.path)
                return (
                  <li
                    key={file.path}
                    className="relative">
                    <button
                      type="button"
                      data-aside-path={file.path}
                      data-aside-kind="file"
                      title={`查看 ${file.path} 的变更`}
                      onClick={function () {
                        openFileDiff(commit, file.path)
                      }}
                      className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors">
                      <span className="min-w-0 flex-1 truncate text-[13px] leading-snug text-foreground">
                        {findReviewBaseName(file.path)}
                      </span>
                      {parent ? (
                        <span className="text-muted-foreground min-w-0 truncate text-xs opacity-70">
                          {parent}
                        </span>
                      ) : null}
                      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
                        {file.added !== null && file.added > 0 ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{file.added}
                          </span>
                        ) : null}
                        {file.deleted !== null && file.deleted > 0 ? (
                          <span className="text-destructive">-{file.deleted}</span>
                        ) : null}
                        <span
                          className={clsx(
                            'w-4 text-center font-semibold',
                            STATUS_STYLE[letter] ?? 'text-muted-foreground'
                          )}>
                          {letter}
                        </span>
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
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部：文件夹切换（与文件树 / 审阅同源） + 工具条 */}
      <div className="border-border flex shrink-0 flex-col border-b">
        <WorkspaceFolderChips />

        <div className="flex items-center gap-1.5 px-2 py-1.5">
          {/* 左侧：分支（可切） */}
          <div className="flex min-w-0 flex-1 items-center justify-start overflow-hidden">
            <BranchSwitcherView
              branch={snapshot.branch}
              locals={snapshot.branches?.branches ?? []}
              remotes={snapshot.branches?.remotes ?? []}
              ahead={snapshot.ahead}
              behind={snapshot.behind}
              isBusy={snapshot.isPending}
              size="sm"
              tone="header"
              className="max-w-full"
              onCheckout={function (name, fromRemote) {
                void checkoutNow(rootPath, name, fromRemote)
              }}
            />
          </div>
          {/* 右侧：搜索 / 刷新 */}
          <div className="relative shrink-0">
            <Input
              value={query}
              placeholder="搜索提交…"
              aria-label="搜索提交"
              className="h-6 w-32 pe-6 ps-6 text-xs"
              onChange={function (event) {
                updateQuery(event.target.value)
              }}
            />
            <Icon
              icon={isPending ? 'lucide:loader-circle' : 'lucide:search'}
              className={clsx(
                'text-muted-foreground pointer-events-none absolute start-1.5 top-1/2 size-3.5 -translate-y-1/2',
                isPending && 'animate-spin'
              )}
            />
            {query ? (
              <button
                type="button"
                aria-label="清空搜索"
                className="text-muted-foreground hover:text-foreground absolute end-1 top-1/2 -translate-y-1/2"
                onClick={function () {
                  updateQuery('')
                }}>
                <Icon
                  icon="lucide:x"
                  className="size-3"
                />
              </button>
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
              className="size-3.5"
            />
          </Button>
        </div>

        {/* 范围 + 远端状态：一行说清「这些提交在哪儿」 */}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          <div className="bg-muted/55 flex items-center gap-0.5 rounded-lg p-0.5">
            <button
              type="button"
              onClick={function () {
                updateScope('all')
              }}
              className={clsx(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                scope === 'all'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              全部 {rows.length}
            </button>
            <button
              type="button"
              title={localCount > 0 ? `${localCount} 个提交还没有推送到上游` : '没有待推送的本地提交'}
              onClick={function () {
                updateScope('local')
              }}
              className={clsx(
                'rounded-md px-2 py-0.5 text-[11px] transition-colors',
                scope === 'local'
                  ? 'bg-background text-amber-700 shadow-xs dark:text-amber-300'
                  : 'text-muted-foreground hover:text-foreground'
              )}>
              仅本地 {localCount}
            </button>
          </div>
          <span
            className="text-muted-foreground ms-auto flex min-w-0 items-center gap-1 truncate text-[11px]"
            title={snapshot.upstream?.hasUpstream ? (snapshot.upstream.upstream ?? undefined) : undefined}>
            <Icon
              icon={snapshot.upstream?.hasUpstream ? 'lucide:cloud' : 'lucide:hard-drive'}
              className="size-3 shrink-0 opacity-70"
            />
            <span className="truncate font-mono">
              {snapshot.upstream?.hasUpstream && snapshot.upstream.upstream
                ? snapshot.upstream.upstream
                : '未设上游'}
            </span>
            {snapshot.ahead > 0 || snapshot.behind > 0 ? (
              <span className="shrink-0 tabular-nums">
                {snapshot.ahead > 0 ? `↑${snapshot.ahead}` : ''}
                {snapshot.behind > 0 ? ` ↓${snapshot.behind}` : ''}
              </span>
            ) : null}
          </span>
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
              <p className="text-muted-foreground p-3 text-xs leading-relaxed">
                {debouncedQuery
                  ? `没有匹配「${debouncedQuery}」的提交`
                  : snapshot.isRepo
                    ? `${folderName} 还没有提交`
                    : `${folderName} 不是 Git 仓库，没有提交历史`}
              </p>
            ) : null}

            {scope === 'local' && visibleRows.length === 0 ? (
              <p className="text-muted-foreground p-3 text-xs">
                本地没有待推送的提交
                {snapshot.upstream?.hasUpstream ? '（已与上游同步）' : '（未设置上游，全部提交都只在本地）'}
              </p>
            ) : null}

            {localRows.length > 0 ? (
              <section>
                <GroupHeader
                  icon="lucide:hard-drive"
                  label="本地未推送"
                  count={localRows.length}
                  tone="local"
                />
                <ul className="flex flex-col px-1.5 py-1">{localRows.map(renderCommit)}</ul>
              </section>
            ) : null}

            {restRows.length > 0 ? (
              <section>
                <GroupHeader
                  icon="lucide:cloud-check"
                  label={localRows.length > 0 ? '已推送到上游' : '提交历史'}
                  count={restRows.length}
                  tone="remote"
                />
                <ul className="flex flex-col px-1.5 py-1">{restRows.map(renderCommit)}</ul>
              </section>
            ) : null}
          </div>
        </ContextMenu>
      )}
    </div>
  )
}

export { AsideHistory }
