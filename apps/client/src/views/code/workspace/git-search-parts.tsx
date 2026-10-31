import { Icon } from '@iconify/react/offline'
import { Badge } from '@cogito/design/components/badge'
import { Skeleton } from '@cogito/design/components/skeleton'
import { cn } from 'cn'
import { useMemo, type ReactNode } from 'react'

import type { CommitHit, ShowFile } from '@/lib/workspace-git'
import {
  GIT_FILE_STATUS_TONE,
  formatCommitRelativeTime,
  findAuthorInitials,
  findGitFileName,
  findGitParentPath
} from '@/views/code/workspace/git-search-format.ts'









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
          {findAuthorInitials(hit.authorName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-foreground line-clamp-1 text-sm leading-5 font-medium">
            {hit.subject || '(无说明)'}
          </span>
          <span className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4">
            <span className="truncate">{hit.authorName}</span>
            <span className="opacity-40">·</span>
            <span className="shrink-0">{formatCommitRelativeTime(hit.committedAt)}</span>
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
  const name = findGitFileName(props.file.path)
  const parent = findGitParentPath(props.file.path)
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
            GIT_FILE_STATUS_TONE[props.file.status] ?? 'text-muted-foreground'
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

export { EmptyState, SectionHeader, CommitRow, FileRow, ChangeStats, LoadingRows }
