/**
 * 搜索结果列表：按文件分组，命中行高亮，点击跳转。
 */
import { Icon } from '@iconify/react/offline'
import { Button } from '@cogito/design/components/button'
import type { ContentHit } from '@/lib/workspace-files'
import { cn } from 'cn'
import { useEffect, useMemo, useState } from 'react'

import { buildPattern } from '@/views/code/lib/search-query.ts'
import type { SearchQuery } from '@/views/code/lib/search-query.ts'

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

/** 在预览行里切出命中片段，用强调色标出来 */
function splitPreview(
  preview: string,
  query: SearchQuery
): { before: string; hit: string; after: string } {
  const pattern = buildPattern(query)
  const matcher = new RegExp(pattern, query.isCaseSensitive ? '' : 'i')
  const found = matcher.exec(preview)
  if (!found) return { before: preview, hit: '', after: '' }
  return {
    before: preview.slice(0, found.index),
    hit: found[0],
    after: preview.slice(found.index + found[0].length)
  }
}

function FileGroupRow(props: {
  group: FileGroup
  query: SearchQuery
  collapseToken: number
  onOpen: (hit: ContentHit) => void
}) {
  const [isOpen, updateOpen] = useState(true)
  const name = props.group.relative.split('/').pop() ?? props.group.relative

  useEffect(
    function () {
      if (props.collapseToken > 0) updateOpen(false)
    },
    [props.collapseToken]
  )

  return (
    <li className="mb-0.5">
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
            const parts = splitPreview(hit.preview, props.query)
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
                  <span className="text-muted-foreground truncate font-mono text-[11px]">
                    {parts.before}
                    {parts.hit ? (
                      <span className="bg-primary/20 text-foreground rounded-[2px] px-0.5">
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
  query: SearchQuery
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {props.isTruncated ? (
        <p className="text-muted-foreground px-1.5 pb-1 text-[11px]">
          结果较多，仅显示前 {props.hits.length} 条
        </p>
      ) : null}
      <ul className={cn('list-none', props.hits.length === 0 && 'hidden')}>
        {groups.map(function (group) {
          return (
            <FileGroupRow
              key={group.relative}
              group={group}
              query={props.query}
              collapseToken={collapseToken}
              onOpen={props.onOpen}
            />
          )
        })}
      </ul>
    </div>
  )
}

export { SearchResults, groupHits }
export type { FileGroup }
