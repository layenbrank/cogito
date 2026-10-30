/**
 * 编辑器独立页「搜索提交」（GitLens Commits 式标签）：
 * 按消息 / 作者 / hash 检索，查看变更并打开 revision diff。
 * 高密度列表、图轨、作者徽标、左右主从布局。
 */
import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Button } from '@cogito/design/components/button'
import { Input } from '@cogito/design/components/input'
import { Separator } from '@cogito/design/components/separator'
import { Skeleton } from '@cogito/design/components/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@cogito/design/components/toggle-group'
import { cn } from 'cn'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import type { CommitHit, SearchField, ShowFile } from '@/lib/workspace-git'
import { useCodeGitStore } from '@/stores/code-git'
import { useCodeStore } from '@/stores/code'
import { joinPath } from '@/views/code/lib/path.ts'
import { BranchSwitcher } from '@/views/code/workspace/scm/branch-switcher.tsx'

const FIELDS: { id: SearchField; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'message', label: '消息' },
  { id: 'author', label: '作者' },
  { id: 'hash', label: 'Hash' }
]

const STATUS_TONE: Record<string, string> = {
  A: 'text-emerald-600 dark:text-emerald-400',
  D: 'text-destructive',
  R: 'text-primary',
  C: 'text-primary',
  T: 'text-amber-600 dark:text-amber-400',
  M: 'text-amber-600 dark:text-amber-400'
}

function formatRelativeTime(unixSeconds: number): string {
  if (!unixSeconds) return ''
  const delta = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (delta < 60) return '刚刚'
  if (delta < 3600) return `${Math.floor(delta / 60)} 分钟前`
  if (delta < 86400) return `${Math.floor(delta / 3600)} 小时前`
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} 天前`
  const date = new Date(unixSeconds * 1000)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function findInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function findFileName(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? relative : relative.slice(slash + 1)
}

function findParentPath(relative: string): string {
  const slash = relative.lastIndexOf('/')
  return slash < 0 ? '' : relative.slice(0, slash)
}

function EmptyState(props: { icon: string; title: string; hint?: string }) {
  return (
    <div className="text-muted-foreground flex h-full min-h-24 flex-col items-center justify-center gap-1.5 px-4 text-center">
      <Icon
        icon={props.icon}
        className="size-5 opacity-40"
      />
      <p className="text-foreground/80 text-sm font-medium">{props.title}</p>
      {props.hint ? <p className="max-w-56 text-xs leading-relaxed opacity-80">{props.hint}</p> : null}
    </div>
  )
}

function SectionHeader(props: {
  title: string
  count?: number
  isLoading?: boolean
  trailing?: ReactNode
}) {
  return (
    <div className="bg-muted/30 border-border/40 flex h-9 shrink-0 items-center gap-2 border-b px-3">
      <span className="text-muted-foreground text-xs font-semibold tracking-[0.06em] uppercase">
        {props.title}
      </span>
      {typeof props.count === 'number' && props.count > 0 ? (
        <Badge
          variant="secondary"
          className="h-5 rounded-sm px-1.5 text-xs font-normal tabular-nums">
          {props.count}
        </Badge>
      ) : null}
      {props.isLoading ? (
        <Icon
          icon="lucide:loader-circle"
          className="text-muted-foreground size-4 animate-spin"
        />
      ) : null}
      {props.trailing ? <div className="ml-auto flex items-center gap-1">{props.trailing}</div> : null}
    </div>
  )
}

function CommitRow(props: {
  hit: CommitHit
  isActive: boolean
  isFirst: boolean
  isLast: boolean
  onSelect: (oid: string) => void
}) {
  const { hit, isActive, isFirst, isLast } = props
  return (
    <li className="relative">
      {/* 连续图轨 */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 bottom-0 left-[1.125rem] flex w-3 justify-center">
        {!isFirst ? <span className="bg-border absolute inset-x-[5px] top-0 h-1/2 w-px" /> : null}
        {!isLast ? <span className="bg-border absolute inset-x-[5px] top-1/2 h-1/2 w-px" /> : null}
        <span
          className={cn(
            'absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background transition-colors',
            isActive
              ? 'bg-primary'
              : hit.isHead
                ? 'bg-primary/70'
                : 'bg-muted-foreground/45'
          )}
        />
      </div>
      <button
        type="button"
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'group/commit hover:bg-muted/50 focus-visible:ring-ring relative flex w-full gap-2.5 py-2 pr-3 pl-9 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset',
          isActive && 'bg-accent/55 hover:bg-accent/65'
        )}
        onClick={function () {
          props.onSelect(hit.oid)
        }}>
        {isActive ? (
          <span
            aria-hidden
            className="bg-primary absolute inset-y-1 left-0 w-0.5 rounded-full"
          />
        ) : null}
        <span
          className={cn(
            'bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold tracking-tight',
            isActive && 'bg-primary/15 text-primary'
          )}
          title={hit.authorName}>
          {findInitials(hit.authorName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground line-clamp-1 text-sm leading-5 font-medium">
            {hit.subject || '(无说明)'}
          </span>
          <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4">
            <span className="truncate">{hit.authorName}</span>
            <span className="opacity-40">·</span>
            <span className="shrink-0">{formatRelativeTime(hit.committedAt)}</span>
            {hit.isHead ? (
              <Badge
                variant="outline"
                className="border-primary/30 text-primary h-5 rounded-sm px-1.5 text-xs font-medium">
                HEAD
              </Badge>
            ) : null}
            <span className="text-foreground/60 ml-auto shrink-0 font-mono text-xs tabular-nums opacity-80 group-hover/commit:opacity-100">
              {hit.short}
            </span>
          </span>
        </span>
      </button>
    </li>
  )
}

function FileRow(props: {
  file: ShowFile
  isActive: boolean
  onOpen: (path: string) => void
}) {
  const name = findFileName(props.file.path)
  const parent = findParentPath(props.file.path)
  return (
    <li>
      <button
        type="button"
        title={`打开差异：${props.file.path}`}
        aria-current={props.isActive ? 'true' : undefined}
        className={cn(
          'group/file hover:bg-muted/60 focus-visible:ring-ring flex w-full items-center gap-2 rounded-sm py-1.5 pr-2.5 pl-2.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset',
          props.isActive && 'bg-accent/55'
        )}
        onClick={function () {
          props.onOpen(props.file.path)
        }}>
        <span
          className={cn(
            'w-5 shrink-0 text-center font-mono text-sm font-semibold',
            STATUS_TONE[props.file.status] ?? 'text-muted-foreground'
          )}>
          {props.file.status}
        </span>
        <span className="text-foreground min-w-0 truncate text-sm font-medium">{name}</span>
        {parent ? (
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs opacity-70">
            {parent}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {typeof props.file.added === 'number' || typeof props.file.deleted === 'number' ? (
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums tracking-tight">
            {typeof props.file.added === 'number' ? (
              <span className="text-emerald-600 dark:text-emerald-400">+{props.file.added}</span>
            ) : null}
            {typeof props.file.added === 'number' && typeof props.file.deleted === 'number' ? (
              <span className="text-muted-foreground/50 mx-0.5"> </span>
            ) : null}
            {typeof props.file.deleted === 'number' ? (
              <span className="text-destructive">-{props.file.deleted}</span>
            ) : null}
          </span>
        ) : null}
        <Icon
          icon="lucide:git-compare"
          className="text-muted-foreground size-4 shrink-0 opacity-0 transition-opacity group-hover/file:opacity-70"
        />
      </button>
    </li>
  )
}

function ChangeStats(props: { files: ShowFile[] }) {
  const totals = useMemo(
    function () {
      let added = 0
      let deleted = 0
      for (const file of props.files) {
        if (typeof file.added === 'number') added += file.added
        if (typeof file.deleted === 'number') deleted += file.deleted
      }
      return { added, deleted }
    },
    [props.files]
  )
  const total = totals.added + totals.deleted
  const addRatio = total > 0 ? totals.added / total : 0.5
  if (props.files.length === 0) return null
  return (
    <div className="text-muted-foreground flex shrink-0 items-center gap-2.5 border-b border-border/40 px-3 py-2.5 text-sm">
      <span className="text-foreground/90 text-sm font-medium tabular-nums">
        {props.files.length} 个文件
      </span>
      {totals.added > 0 || totals.deleted > 0 ? (
        <>
          <span className="text-emerald-600 dark:text-emerald-400 font-mono text-sm font-semibold tabular-nums">
            +{totals.added}
          </span>
          <span className="text-destructive font-mono text-sm font-semibold tabular-nums">
            -{totals.deleted}
          </span>
          <span
            aria-hidden
            className="bg-muted ml-auto flex h-2.5 w-24 overflow-hidden rounded-full">
            <span
              className="bg-emerald-500/80 h-full"
              style={{ width: `${Math.round(addRatio * 100)}%` }}
            />
            <span className="bg-destructive/80 h-full flex-1" />
          </span>
        </>
      ) : null}
    </div>
  )
}

function LoadingRows(props: { count: number }) {
  return (
    <ul className="flex flex-col gap-1 p-2">
      {Array.from({ length: props.count }).map(function (_, index) {
        return (
          <li
            key={index}
            className="flex items-center gap-2 px-1 py-1">
            <Skeleton className="size-6 rounded-full" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-[72%]" />
              <Skeleton className="h-2.5 w-[42%]" />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function GitSearch() {
  const workspaceRoot = useCodeStore(function (state) {
    return state.workspaceRoot
  })
  const isRepo = useCodeGitStore(function (state) {
    return state.isRepo
  })
  const searchQuery = useCodeGitStore(function (state) {
    return state.searchQuery
  })
  const searchField = useCodeGitStore(function (state) {
    return state.searchField
  })
  const searchHits = useCodeGitStore(function (state) {
    return state.searchHits
  })
  const searchHasMore = useCodeGitStore(function (state) {
    return state.searchHasMore
  })
  const searchHitScanCap = useCodeGitStore(function (state) {
    return state.searchHitScanCap
  })
  const isSearchLoading = useCodeGitStore(function (state) {
    return state.isSearchLoading
  })
  const searchError = useCodeGitStore(function (state) {
    return state.searchError
  })
  const selectedOid = useCodeGitStore(function (state) {
    return state.selectedOid
  })
  const commitFiles = useCodeGitStore(function (state) {
    return state.commitFiles
  })
  const isShowLoading = useCodeGitStore(function (state) {
    return state.isShowLoading
  })
  const showError = useCodeGitStore(function (state) {
    return state.showError
  })
  const recentHits = useCodeGitStore(function (state) {
    return state.recentHits
  })

  const [draft, updateDraft] = useState(searchQuery)
  const [fileFilter, updateFileFilter] = useState('')
  const [activeFilePath, updateActiveFilePath] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didBootstrap = useRef(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selectedHit = useMemo(
    function () {
      return (
        searchHits.find(function (hit) {
          return hit.oid === selectedOid
        }) ??
        recentHits.find(function (hit) {
          return hit.oid === selectedOid
        })
      )
    },
    [searchHits, recentHits, selectedOid]
  )

  const filteredFiles = useMemo(
    function () {
      const needle = fileFilter.trim().toLowerCase()
      if (!needle) return commitFiles
      return commitFiles.filter(function (file) {
        return file.path.toLowerCase().includes(needle)
      })
    },
    [commitFiles, fileFilter]
  )

  useEffect(
    function () {
      if (!isRepo || didBootstrap.current) return
      didBootstrap.current = true
      void useCodeGitStore.getState().toSearchCommits()
    },
    [isRepo]
  )

  // 侧栏 toFocusCommit 会改 store.searchQuery，输入框跟进
  useEffect(
    function () {
      updateDraft(searchQuery)
    },
    [searchQuery]
  )

  useEffect(
    function () {
      updateFileFilter('')
      updateActiveFilePath(null)
    },
    [selectedOid]
  )

  useEffect(
    function () {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(function () {
        const store = useCodeGitStore.getState()
        if (store.searchQuery === draft) return
        store.toSetSearchQuery(draft)
        void store.toSearchCommits()
      }, 280)
      return function () {
        if (debounceRef.current) clearTimeout(debounceRef.current)
      }
    },
    [draft]
  )

  function runSearchNow(nextDraft = draft) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const store = useCodeGitStore.getState()
    store.toSetSearchQuery(nextDraft)
    void store.toSearchCommits()
  }

  function onField(field: SearchField) {
    useCodeGitStore.getState().toSetSearchField(field)
    runSearchNow()
  }

  function onSelect(oid: string) {
    void useCodeGitStore.getState().toSelectCommit(oid)
  }

  function onOpenFile(relative: string) {
    if (!workspaceRoot || !selectedOid) return
    updateActiveFilePath(relative)
    const parentOid = selectedHit?.parentOid ?? null
    useCodeStore.getState().toOpenDiffTab({
      path: joinPath(workspaceRoot, relative),
      baseOid: parentOid ?? '',
      headOid: selectedOid,
      titleHint: selectedOid.slice(0, 7)
    })
  }

  function onCopySha(oid: string) {
    void navigator.clipboard.writeText(oid).then(
      function () {
        toast.success('已复制 SHA')
      },
      function (error) {
        console.error('[code] copy sha failed', error)
        toast.error('复制失败')
      }
    )
  }

  function onCommitKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (searchHits.length === 0) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const index = searchHits.findIndex(function (hit) {
      return hit.oid === selectedOid
    })
    const nextIndex =
      event.key === 'ArrowDown'
        ? Math.min(searchHits.length - 1, Math.max(0, index) + 1)
        : Math.max(0, (index < 0 ? 0 : index) - 1)
    const next = searchHits[nextIndex]
    if (next) onSelect(next.oid)
  }

  if (!workspaceRoot) {
    return (
      <EmptyState
        icon="lucide:folder-open"
        title="尚未打开文件夹"
        hint="打开工作区后即可搜索提交历史"
      />
    )
  }

  if (!isRepo) {
    return (
      <EmptyState
        icon="lucide:git-branch"
        title="当前文件夹不是 Git 仓库"
        hint="在仓库根目录打开文件夹后重试"
      />
    )
  }

  const showCommitSkeleton = isSearchLoading && searchHits.length === 0
  const showFileSkeleton = isShowLoading && commitFiles.length === 0 && Boolean(selectedOid)

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="border-border/50 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <BranchSwitcher
          tone="toolbar"
          className="shrink-0"
        />
        <div className="relative min-w-[14rem] flex-1">
          <Icon
            icon="lucide:search"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            value={draft}
            placeholder="搜索消息、作者或提交哈希…"
            aria-label="搜索提交"
            className="bg-muted/40 border-border/60 h-9 pl-8 text-sm shadow-none"
            onChange={function (event) {
              updateDraft(event.target.value)
            }}
            onKeyDown={function (event) {
              if (event.key !== 'Enter') return
              event.preventDefault()
              runSearchNow()
            }}
          />
          {draft ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="清除搜索"
              className="text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2"
              onClick={function () {
                updateDraft('')
                runSearchNow('')
              }}>
              <Icon
                icon="lucide:x"
                className="size-3.5"
              />
            </Button>
          ) : null}
        </div>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[searchField]}
          className="shrink-0"
          onValueChange={function (value) {
            const next = value[0] as SearchField | undefined
            if (next) onField(next)
          }}>
          {FIELDS.map(function (field) {
            return (
              <ToggleGroupItem
                key={field.id}
                value={field.id}
                className="h-9 px-3 text-sm">
                {field.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="刷新"
          title="刷新"
          className="text-muted-foreground size-8 shrink-0"
          disabled={isSearchLoading}
          onClick={function () {
            runSearchNow()
          }}>
          <Icon
            icon="lucide:refresh-cw"
            className={cn('size-4', isSearchLoading && 'animate-spin')}
          />
        </Button>
      </div>

      {(searchError || showError || searchHitScanCap) && (
        <div className="border-border/40 flex shrink-0 flex-col gap-0.5 border-b px-3 py-2">
          {searchError || showError ? (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <Icon
                icon="lucide:circle-alert"
                className="size-3.5 shrink-0"
              />
              {searchError || showError}
            </p>
          ) : null}
          {searchHitScanCap ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Icon
                icon="lucide:info"
                className="size-3.5 shrink-0"
              />
              已达扫描上限，结果可能不完整
            </p>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="border-border/50 flex min-h-0 min-w-0 flex-[1.15] flex-col border-b lg:border-r lg:border-b-0">
          <SectionHeader
            title="Commits"
            count={searchHits.length}
            isLoading={isSearchLoading && searchHits.length > 0}
            trailing={
              draft.trim() ? (
                <span className="text-muted-foreground max-w-40 truncate text-xs">
                  “{draft.trim()}”
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">最近提交</span>
              )
            }
          />
          <div
            ref={listRef}
            tabIndex={0}
            role="listbox"
            aria-label="提交列表"
            className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-ring/40 focus-visible:ring-inset"
            onKeyDown={onCommitKeyDown}>
            {showCommitSkeleton ? <LoadingRows count={6} /> : null}
            {!showCommitSkeleton && searchHits.length === 0 ? (
              <EmptyState
                icon="lucide:search-x"
                title={draft.trim() ? '无匹配提交' : '暂无提交'}
                hint={
                  draft.trim()
                    ? '试试更短的关键词，或切换作用域'
                    : '仓库还没有任何提交记录'
                }
              />
            ) : null}
            {!showCommitSkeleton && searchHits.length > 0 ? (
              <ul className="flex flex-col py-0.5">
                {searchHits.map(function (hit, index) {
                  return (
                    <CommitRow
                      key={hit.oid}
                      hit={hit}
                      isActive={hit.oid === selectedOid}
                      isFirst={index === 0}
                      isLast={index === searchHits.length - 1 && !searchHasMore}
                      onSelect={onSelect}
                    />
                  )
                })}
              </ul>
            ) : null}
            {searchHasMore ? (
              <div className="flex justify-center border-t border-border/30 p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground h-9 gap-1.5 text-sm"
                  disabled={isSearchLoading}
                  onClick={function () {
                    void useCodeGitStore.getState().toLoadMoreSearch()
                  }}>
                  {isSearchLoading ? (
                    <Icon
                      icon="lucide:loader-circle"
                      className="size-4 animate-spin"
                    />
                  ) : (
                    <Icon
                      icon="lucide:chevrons-down"
                      className="size-4"
                    />
                  )}
                  加载更多
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SectionHeader
            title="Changes"
            count={commitFiles.length}
            isLoading={isShowLoading && commitFiles.length > 0}
            trailing={
              selectedOid ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="复制完整 SHA"
                    title="复制完整 SHA"
                    className="text-muted-foreground size-7"
                    onClick={function () {
                      onCopySha(selectedOid)
                    }}>
                    <Icon
                      icon="lucide:copy"
                      className="size-3.5"
                    />
                  </Button>
                </div>
              ) : null
            }
          />
          {selectedHit ? (
            <div className="border-border/40 bg-muted/20 flex shrink-0 flex-col gap-1 border-b px-2.5 py-2">
              <p className="text-foreground line-clamp-2 text-sm leading-5 font-medium">
                {selectedHit.subject || '(无说明)'}
              </p>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold">
                  {findInitials(selectedHit.authorName)}
                </span>
                <span>{selectedHit.authorName}</span>
                <Separator
                  orientation="vertical"
                  className="h-3.5"
                />
                <span>{formatRelativeTime(selectedHit.committedAt)}</span>
                <Separator
                  orientation="vertical"
                  className="h-3.5"
                />
                <button
                  type="button"
                  className="hover:text-foreground font-mono text-xs tabular-nums underline-offset-2 hover:underline"
                  title="点击复制完整 SHA"
                  onClick={function () {
                    onCopySha(selectedHit.oid)
                  }}>
                  {selectedHit.short}
                </button>
                {selectedHit.parentOid ? (
                  <>
                    <Separator
                      orientation="vertical"
                      className="h-3.5"
                    />
                    <span className="font-mono text-xs tabular-nums opacity-70">
                      {selectedHit.parentOid.slice(0, 7)}..{selectedHit.short}
                    </span>
                  </>
                ) : (
                  <Badge
                    variant="secondary"
                    className="h-5 rounded-sm px-1.5 text-xs">
                    根提交
                  </Badge>
                )}
              </div>
            </div>
          ) : null}
          {selectedOid && !showFileSkeleton ? <ChangeStats files={commitFiles} /> : null}
          {selectedOid && commitFiles.length > 0 ? (
            <div className="border-border/40 relative flex shrink-0 items-center gap-1.5 border-b px-2.5 py-2">
              <Icon
                icon="lucide:filter"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2"
              />
              <Input
                value={fileFilter}
                placeholder="筛选文件…"
                aria-label="筛选变更文件"
                className="bg-muted/30 border-border/50 h-9 pl-9 text-sm shadow-none"
                onChange={function (event) {
                  updateFileFilter(event.target.value)
                }}
              />
              {fileFilter ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="清除筛选"
                  className="text-muted-foreground size-7 shrink-0"
                  onClick={function () {
                    updateFileFilter('')
                  }}>
                  <Icon
                    icon="lucide:x"
                    className="size-3.5"
                  />
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {!selectedOid ? (
              <EmptyState
                icon="lucide:file-diff"
                title="选择一个提交"
                hint="左侧点选后，这里会列出该提交的文件变更"
              />
            ) : null}
            {showFileSkeleton ? <LoadingRows count={5} /> : null}
            {selectedOid && !showFileSkeleton && commitFiles.length === 0 ? (
              <EmptyState
                icon="lucide:file-x"
                title="没有文件变更"
                hint="该提交可能是空提交或仅改动了元数据"
              />
            ) : null}
            {selectedOid &&
            !showFileSkeleton &&
            commitFiles.length > 0 &&
            filteredFiles.length === 0 ? (
              <EmptyState
                icon="lucide:search-x"
                title="无匹配文件"
                hint="试试更短的路径片段"
              />
            ) : null}
            {selectedOid && !showFileSkeleton && filteredFiles.length > 0 ? (
              <ul className="flex flex-col">
                {filteredFiles.map(function (file) {
                  return (
                    <FileRow
                      key={`${file.status}:${file.path}`}
                      file={file}
                      isActive={file.path === activeFilePath}
                      onOpen={onOpenFile}
                    />
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export { GitSearch }
