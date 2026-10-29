/**
 * 搜索结果列表：按文件分组，命中行高亮，点击跳转。
 * 高亮偏移由 Rust `matchStart`/`matchEnd` 提供；preview 已在后端开窗，前端只切片。
 * 首次搜索展示交错入场的骨架；结果就绪后淡入。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import { Skeleton } from '@cogito/design/components/skeleton'
import type { ContentHit } from '@/lib/workspace-files'
import { cn } from 'cn'
import { useMemo, useState } from 'react'

interface FileGroup {
  relative: string
  path: string
  hits: ContentHit[]
}

function groupHits(hits: ContentHit[]): FileGroup[] {
  const groups: FileGroup[] = []
  const byRelative = new Map<string, FileGroup>()
  for (const hit of hits) {
    let group = byRelative.get(hit.relative)
    if (!group) {
      group = { relative: hit.relative, path: hit.path, hits: [] }
      byRelative.set(hit.relative, group)
      groups.push(group)
    }
    group.hits.push(hit)
  }
  return groups
}

/** 按 Unicode 标量偏移切出 before / hit / after（preview 已由 Rust 裁短） */
function splitPreview(hit: ContentHit): { before: string; hit: string; after: string } {
  const chars = Array.from(hit.preview)
  const start = Math.max(0, Math.min(hit.matchStart ?? 0, chars.length))
  const end = Math.max(start, Math.min(hit.matchEnd ?? start, chars.length))
  if (end <= start) {
    return { before: hit.preview, hit: '', after: '' }
  }
  return {
    before: chars.slice(0, start).join(''),
    hit: chars.slice(start, end).join(''),
    after: chars.slice(end).join('')
  }
}

const SKELETON_ROWS = [
  { file: '68%', line: '78%', delay: '0ms' },
  { file: '52%', line: '64%', delay: '60ms' },
  { file: '74%', line: '70%', delay: '120ms' },
  { file: '44%', line: '58%', delay: '180ms' },
  { file: '60%', line: '72%', delay: '240ms' }
] as const

/** 仿结果树结构的骨架：交错 fade + 轻微上滑 */
function SearchLoadingSkeleton() {
  return (
    <ul
      className="animate-in fade-in-0 motion-reduce:animate-none flex list-none flex-col gap-1.5 py-1 duration-300"
      aria-hidden>
      {SKELETON_ROWS.map(function (row, index) {
        return (
          <li
            key={index}
            className="animate-in fade-in-0 slide-in-from-top-1 fill-mode-both motion-reduce:animate-none duration-300"
            style={{ animationDelay: row.delay }}>
            <div className="flex items-center gap-1.5 px-1.5 py-1">
              <Skeleton className="size-3 shrink-0 rounded-sm motion-reduce:animate-none" />
              <Skeleton
                className="h-3 motion-reduce:animate-none"
                style={{ width: row.file }}
              />
              <Skeleton className="ml-auto h-2.5 w-4 shrink-0 motion-reduce:animate-none" />
            </div>
            <div className="flex items-baseline gap-2 py-0.5 pr-1.5 pl-6">
              <Skeleton className="h-2.5 w-6 shrink-0 motion-reduce:animate-none" />
              <Skeleton
                className="h-2.5 motion-reduce:animate-none"
                style={{ width: row.line }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function FileGroupRow(props: {
  group: FileGroup
  collapseToken: number
  index: number
  onOpen: (hit: ContentHit) => void
}) {
  const [isOpen, updateOpen] = useState(true)
  const [seenCollapseToken, setSeenCollapseToken] = useState(props.collapseToken)
  if (props.collapseToken !== seenCollapseToken) {
    setSeenCollapseToken(props.collapseToken)
    if (props.collapseToken > 0) updateOpen(false)
  }
  const name = props.group.relative.split('/').pop() ?? props.group.relative
  const enterDelay = `${Math.min(props.index, 8) * 28}ms`

  return (
    <li
      className="animate-in fade-in-0 slide-in-from-top-1 fill-mode-both motion-reduce:animate-none mb-0.5 duration-200"
      style={{ animationDelay: enterDelay }}>
      <Button
        variant="ghost"
        type="button"
        className="h-auto hover:bg-muted/60 flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left"
        title={props.group.relative}
        onClick={function () {
          updateOpen(!isOpen)
        }}>
        <Icon
          icon={isOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'}
          className="text-muted-foreground size-3 shrink-0 opacity-70"
        />
        <span className="text-foreground truncate text-xs">{name}</span>
        <span className="text-muted-foreground truncate text-[11px] opacity-70">
          {props.group.relative}
        </span>
        <span className="text-muted-foreground ml-auto shrink-0 text-[11px]">
          {props.group.hits.length}
        </span>
      </Button>
      {isOpen ? (
        <ul className="list-none">
          {props.group.hits.map(function (hit) {
            const parts = splitPreview(hit)
            return (
              <li key={`${hit.line}:${hit.column}`}>
                <Button
                  variant="ghost"
                  type="button"
                  className="h-auto hover:bg-muted/60 flex w-full items-baseline gap-2 rounded-sm py-0.5 pr-1.5 pl-6 text-left"
                  title={`第 ${hit.line} 行`}
                  onClick={function () {
                    props.onOpen(hit)
                  }}>
                  <span className="text-muted-foreground/70 w-8 shrink-0 text-right font-mono text-[11px]">
                    {hit.line}
                  </span>
                  <span className="text-muted-foreground min-w-0 truncate font-mono text-[11px]">
                    {parts.before}
                    {parts.hit ? (
                      <span className="rounded-[2px] bg-warning/55 px-0.5 text-warning-foreground">
                        {parts.hit}
                      </span>
                    ) : null}
                    {parts.after}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}

function SearchResults(props: {
  hits: ContentHit[]
  isSearching?: boolean
  isTruncated: boolean
  collapseToken?: number
  onOpen: (hit: ContentHit) => void
}) {
  const groups = useMemo(
    function () {
      return groupHits(props.hits)
    },
    [props.hits]
  )
  const collapseToken = props.collapseToken ?? 0
  const showSkeleton = Boolean(props.isSearching) && props.hits.length === 0

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      {props.isTruncated && props.hits.length > 0 ? (
        <p className="text-muted-foreground px-1.5 pb-1 text-[11px]">
          结果较多，仅显示前 {props.hits.length} 条
        </p>
      ) : null}

      {showSkeleton ? <SearchLoadingSkeleton /> : null}

      <ul
        className={cn(
          'list-none transition-opacity duration-200 motion-reduce:transition-none',
          props.hits.length === 0 && 'hidden',
          props.isSearching && props.hits.length > 0 && 'opacity-55'
        )}>
        {groups.map(function (group, index) {
          return (
            <FileGroupRow
              key={group.relative}
              group={group}
              index={index}
              collapseToken={collapseToken}
              onOpen={props.onOpen}
            />
          )
        })}
      </ul>

      {props.isSearching && props.hits.length > 0 ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-background/80 to-transparent"
        />
      ) : null}
    </div>
  )
}

export { SearchResults, groupHits }
export type { FileGroup }
